// Type Scale — Figma plugin main thread.
//
// Selects the largest text layer as the "anchor" (e.g. a headline) and steps the
// smaller selected text layers down a modular scale by a chosen ratio. It also
// re-distributes the vertical gap between the layers proportionally, so a heading
// and subheading end up at the right size *and* the right distance apart.
//
// Everything is applied live so the user can audition ratios; Cmd/Ctrl+Z undoes.

interface ScaleSettings {
  ratio: number; // modular scale ratio, e.g. 1.25
  spacing: number; // gap between layers, as a multiple of the lower layer's font size
  applyLineHeight: boolean;
  lineHeight: number; // line height as a multiple of font size, e.g. 1.2
  rounding: number; // round font sizes to this step (e.g. 1 = whole px, 0.5 = half px)
}

interface LayerInfo {
  id: string;
  name: string;
  level: number; // 0 = anchor (largest), 1 = one step down, ...
  currentSize: number;
  targetSize: number;
}

const DEFAULTS: ScaleSettings = {
  ratio: 1.25,
  spacing: 0.5,
  applyLineHeight: false,
  lineHeight: 1.2,
  rounding: 1,
};

figma.showUI(__html__, { width: 320, height: 560, themeColors: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSelectedTextNodes(): TextNode[] {
  return figma.currentPage.selection.filter(
    (node): node is TextNode => node.type === "TEXT"
  );
}

// A text layer's font size can be `figma.mixed` when ranges use different sizes.
// We treat the largest size in the layer as its representative size.
function representativeSize(node: TextNode): number {
  if (node.fontSize !== figma.mixed) {
    return node.fontSize as number;
  }
  const segments = node.getStyledTextSegments(["fontSize"]);
  if (segments.length === 0) return 16;
  return segments.reduce((max, seg) => Math.max(max, seg.fontSize), 0);
}

async function loadFontsForNode(node: TextNode): Promise<void> {
  if (node.characters.length === 0) {
    if (node.fontName !== figma.mixed) {
      await figma.loadFontAsync(node.fontName as FontName);
    }
    return;
  }
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
}

function roundTo(value: number, step: number): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

// Build the ordered list of layers + their target sizes for a given ratio.
// The largest layer is the anchor and keeps its size; each successive (smaller)
// layer is one step further down the scale.
function computePlan(nodes: TextNode[], settings: ScaleSettings): LayerInfo[] {
  const withSize = nodes.map((n) => ({ node: n, size: representativeSize(n) }));

  // Sort by font size descending; break ties by vertical position (top first).
  withSize.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return a.node.y - b.node.y;
  });

  const anchorSize = withSize.length > 0 ? withSize[0].size : 16;

  return withSize.map((entry, index) => {
    const target = roundTo(
      anchorSize / Math.pow(settings.ratio, index),
      settings.rounding
    );
    return {
      id: entry.node.id,
      name: entry.node.name,
      level: index,
      currentSize: entry.size,
      targetSize: target,
    };
  });
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

async function applyScale(settings: ScaleSettings): Promise<void> {
  const nodes = getSelectedTextNodes();
  if (nodes.length < 2) return;

  const plan = computePlan(nodes, settings);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 1. Resize fonts (and optionally line height).
  for (const item of plan) {
    const node = byId.get(item.id);
    if (!node) continue;
    await loadFontsForNode(node);
    node.fontSize = item.targetSize;
    if (settings.applyLineHeight) {
      node.lineHeight = {
        value: item.targetSize * settings.lineHeight,
        unit: "PIXELS",
      };
    }
  }

  // 2. Re-distribute spacing. Order layers top -> bottom by their current Y.
  //    The topmost layer stays put; each following layer is placed below the
  //    previous one with a gap proportional to the lower layer's font size.
  const sizeById = new Map(plan.map((p) => [p.id, p.targetSize]));
  const ordered = plan
    .map((p) => byId.get(p.id))
    .filter((n): n is TextNode => !!n)
    .sort((a, b) => a.y - b.y);

  // If the layers live inside an auto-layout frame, drive spacing through the
  // parent instead of moving nodes manually.
  const parent = ordered[0] && ordered[0].parent;
  const sameAutoLayoutParent =
    parent &&
    "layoutMode" in parent &&
    (parent as FrameNode).layoutMode !== "NONE" &&
    ordered.every((n) => n.parent === parent);

  if (sameAutoLayoutParent) {
    const lowerSize = sizeById.get(ordered[ordered.length - 1].id) || 16;
    (parent as FrameNode).itemSpacing = Math.round(lowerSize * settings.spacing);
  } else {
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const curr = ordered[i];
      const lowerSize = sizeById.get(curr.id) || representativeSize(curr);
      const gap = lowerSize * settings.spacing;
      curr.y = prev.y + prev.height + gap;
    }
  }
}

// ---------------------------------------------------------------------------
// UI <-> main messaging
// ---------------------------------------------------------------------------

function sendSelection(settings: ScaleSettings): void {
  const nodes = getSelectedTextNodes();
  const plan = nodes.length >= 2 ? computePlan(nodes, settings) : [];
  figma.ui.postMessage({
    type: "selection",
    count: nodes.length,
    layers: plan.map((p) => ({
      name: p.name,
      level: p.level,
      currentSize: Math.round(p.currentSize * 10) / 10,
      targetSize: Math.round(p.targetSize * 10) / 10,
    })),
  });
}

let currentSettings: ScaleSettings = { ...DEFAULTS };

figma.ui.onmessage = async (msg: { type: string; settings?: ScaleSettings }) => {
  if (msg.type === "ready") {
    figma.clientStorage
      .getAsync("typescale-settings")
      .then((saved: ScaleSettings | undefined) => {
        if (saved) currentSettings = { ...DEFAULTS, ...saved };
        figma.ui.postMessage({ type: "settings", settings: currentSettings });
        sendSelection(currentSettings);
      });
    return;
  }

  if (msg.type === "preview" && msg.settings) {
    currentSettings = { ...DEFAULTS, ...msg.settings };
    sendSelection(currentSettings);
    return;
  }

  if (msg.type === "apply" && msg.settings) {
    currentSettings = { ...DEFAULTS, ...msg.settings };
    await applyScale(currentSettings);
    await figma.clientStorage.setAsync("typescale-settings", currentSettings);
    sendSelection(currentSettings);
    return;
  }
};

figma.on("selectionchange", () => sendSelection(currentSettings));
