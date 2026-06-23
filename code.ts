// Type Scale v2 — Figma plugin main thread.
//
// A small *typographic system* you define once and re-apply to any selection:
//  - assign each selected text layer a custom ROLE ("what is what")
//  - each role sits on a modular scale step -> font size = base * ratio^step
//  - line-height & letter-spacing follow optical curves (tighter for large text,
//    looser/positive tracking for small text), overridable per role
//  - vertical spacing is either baseline-grid or size-proportional
//  - the whole system + named presets persist via clientStorage (repeatable)
//
// All scale math lives here (the UI is presentational). Changes apply live so the
// user can audition; Cmd/Ctrl+Z undoes.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpacingMode = "grid" | "proportional";
type TextCaseOpt = "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";

interface LeadingSettings {
  enabled: boolean;
  bodyLH: number; // line-height multiplier at base size, e.g. 1.5
  displayLH: number; // line-height multiplier at displaySize, e.g. 1.0
  displaySize: number; // size at/above which displayLH applies, e.g. 48
}

interface SystemSettings {
  baseSize: number;
  ratio: number;
  rounding: number;
  leading: LeadingSettings;
  trackingEnabled: boolean;
  trackingStrength: number; // scales the Inter tracking curve (0 = none, 1 = full)
  spacingEnabled: boolean;
  spacingMode: SpacingMode;
  baseUnit: number; // grid unit in px, e.g. 8
  spacingAmount: number; // grid: multiples of baseUnit; proportional: x lowerSize
}

interface RoleOverrides {
  lineHeight: number | null; // multiplier override (null = use curve)
  trackingPct: number | null; // percent override (null = use curve)
  weight: string | null; // font style name override, e.g. "Bold" (null = keep)
  textCase: TextCaseOpt | null; // null = keep
}

interface Role {
  id: string;
  name: string;
  step: number;
  overrides: RoleOverrides;
}

interface PersistState {
  system: SystemSettings;
  roles: Role[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM: SystemSettings = {
  baseSize: 16,
  ratio: 1.25,
  rounding: 1,
  leading: { enabled: true, bodyLH: 1.5, displayLH: 1.0, displaySize: 48 },
  trackingEnabled: true,
  trackingStrength: 1,
  spacingEnabled: true,
  spacingMode: "proportional",
  baseUnit: 8,
  spacingAmount: 0.5,
};

function emptyOverrides(): RoleOverrides {
  return { lineHeight: null, trackingPct: null, weight: null, textCase: null };
}

// Seeded starter roles — fully editable/deletable by the user.
function defaultRoles(): Role[] {
  return [
    { id: "r-display", name: "Display", step: 4, overrides: emptyOverrides() },
    { id: "r-headline", name: "Headline", step: 3, overrides: emptyOverrides() },
    { id: "r-title", name: "Title", step: 2, overrides: emptyOverrides() },
    { id: "r-subhead", name: "Subhead", step: 1, overrides: emptyOverrides() },
    { id: "r-body", name: "Body", step: 0, overrides: emptyOverrides() },
    {
      id: "r-eyebrow",
      name: "Eyebrow",
      step: -1,
      overrides: { lineHeight: null, trackingPct: 8, weight: null, textCase: "UPPER" },
    },
    { id: "r-caption", name: "Caption", step: -1, overrides: emptyOverrides() },
  ];
}

// Inter "Dynamic Metrics" tracking curve (em): a + b*e^(c*size).
const TRACK_A = -0.0223;
const TRACK_B = 0.185;
const TRACK_C = -0.1745;

// ---------------------------------------------------------------------------
// Pure scale math
// ---------------------------------------------------------------------------

function roundTo(value: number, step: number): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

function computeSize(step: number, sys: SystemSettings): number {
  return roundTo(sys.baseSize * Math.pow(sys.ratio, step), sys.rounding);
}

// Line-height multiplier from the optical curve, or null if leading disabled.
function computeLineHeight(size: number, sys: SystemSettings): number | null {
  const l = sys.leading;
  if (!l.enabled) return null;
  const lo = Math.min(l.bodyLH, l.displayLH);
  const hi = Math.max(l.bodyLH, l.displayLH);
  let m: number;
  if (l.displaySize <= sys.baseSize || size <= sys.baseSize) {
    m = l.bodyLH;
  } else if (size >= l.displaySize) {
    m = l.displayLH;
  } else {
    const t = (size - sys.baseSize) / (l.displaySize - sys.baseSize);
    m = l.bodyLH + (l.displayLH - l.bodyLH) * t;
  }
  return Math.max(lo, Math.min(hi, m));
}

// Tracking percent (1em = 100%) from the Inter curve, or null if disabled.
function computeTrackingPct(size: number, sys: SystemSettings): number | null {
  if (!sys.trackingEnabled) return null;
  const em = TRACK_A + TRACK_B * Math.exp(TRACK_C * size);
  return Math.round(sys.trackingStrength * em * 100 * 1000) / 1000;
}

// Vertical gap above an element, given the size of the lower (current) element.
function computeGap(lowerSize: number, sys: SystemSettings): number {
  if (sys.spacingMode === "grid") {
    return Math.round(sys.spacingAmount * sys.baseUnit);
  }
  return Math.round(sys.spacingAmount * lowerSize);
}

// ---------------------------------------------------------------------------
// Figma helpers
// ---------------------------------------------------------------------------

function getSelectedTextNodes(): TextNode[] {
  return figma.currentPage.selection.filter(
    (node): node is TextNode => node.type === "TEXT"
  );
}

function representativeSize(node: TextNode): number {
  if (node.fontSize !== figma.mixed) return node.fontSize as number;
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

// ---------------------------------------------------------------------------
// Role suggestion (nearest role by size) + on-canvas badges
// ---------------------------------------------------------------------------

// Size-aware detection: pick, per node, the role whose target size
// (base * ratio^step) is closest to the node's actual size. This replaces the
// old rank-based guess that always pushed the largest layer to the top role.
function suggestRoles(nodes: TextNode[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (currentRoles.length === 0) return out;
  for (const node of nodes) {
    const size = representativeSize(node);
    let best = currentRoles[0];
    let bestDiff = Infinity;
    for (const r of currentRoles) {
      const diff = Math.abs(computeSize(r.step, currentSystem) - size);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = r;
      }
    }
    out[node.id] = best.id;
  }
  return out;
}

let badgeNodes: SceneNode[] = [];
let showBadges = true;

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}

// Stable per-role color from its id, so the same role always reads the same
// hue on canvas and in the panel chip.
function roleColor(roleId: string): RGB {
  let h = 0;
  for (let i = 0; i < roleId.length; i++) h = (h * 31 + roleId.charCodeAt(i)) >>> 0;
  return hslToRgb((h % 360) / 360, 0.68, 0.45);
}

function clearBadges(): void {
  for (const b of badgeNodes) {
    try {
      b.remove();
    } catch (e) {
      // already removed
    }
  }
  badgeNodes = [];
}

// Draw a small locked pill above each assigned text layer naming its role.
async function drawBadges(assignments: Record<string, string>): Promise<void> {
  clearBadges();
  if (!showBadges) return;
  const nodes = getSelectedTextNodes();
  if (nodes.length === 0) return;

  let font: FontName = { family: "Inter", style: "Medium" };
  try {
    await figma.loadFontAsync(font);
  } catch (e) {
    font = { family: "Roboto", style: "Regular" };
    try {
      await figma.loadFontAsync(font);
    } catch (e2) {
      return; // no usable font for labels
    }
  }

  const rolesById = new Map(currentRoles.map((r) => [r.id, r]));
  for (const node of nodes) {
    const role = rolesById.get(assignments[node.id]);
    if (!role) continue;
    const box = node.absoluteBoundingBox;
    if (!box) continue;

    const badge = figma.createFrame();
    badge.name = "⟦ type badge ⟧";
    badge.setPluginData("tsBadge", "1");
    badge.layoutMode = "HORIZONTAL";
    badge.primaryAxisSizingMode = "AUTO";
    badge.counterAxisSizingMode = "AUTO";
    badge.paddingLeft = 6;
    badge.paddingRight = 6;
    badge.paddingTop = 3;
    badge.paddingBottom = 3;
    badge.cornerRadius = 4;
    badge.fills = [{ type: "SOLID", color: roleColor(role.id) }];

    const label = figma.createText();
    label.fontName = font;
    label.fontSize = 11;
    label.characters = role.name;
    label.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    badge.appendChild(label);

    figma.currentPage.appendChild(badge);
    badge.x = Math.round(box.x);
    badge.y = Math.round(box.y - badge.height - 4);
    badge.locked = true;
    badgeNodes.push(badge);
  }
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

interface PlanItem {
  node: TextNode;
  role: Role;
  size: number;
  lineHeight: number | null;
  trackingPct: number | null;
  gapAbove: number | null;
}

function buildPlan(
  nodes: TextNode[],
  sys: SystemSettings,
  roles: Role[],
  assignments: Record<string, string>
): PlanItem[] {
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const items: PlanItem[] = [];

  for (const node of nodes) {
    const roleId = assignments[node.id];
    if (!roleId) continue;
    const role = rolesById.get(roleId);
    if (!role) continue;

    const size = computeSize(role.step, sys);
    const lineHeight =
      role.overrides.lineHeight != null
        ? role.overrides.lineHeight
        : computeLineHeight(size, sys);
    const trackingPct =
      role.overrides.trackingPct != null
        ? role.overrides.trackingPct
        : computeTrackingPct(size, sys);

    items.push({ node, role, size, lineHeight, trackingPct, gapAbove: null });
  }

  // Compute the gap above each assigned layer in top->bottom visual order.
  if (sys.spacingEnabled && items.length > 1) {
    const ordered = items.slice().sort((a, b) => a.node.y - b.node.y);
    for (let i = 1; i < ordered.length; i++) {
      ordered[i].gapAbove = computeGap(ordered[i].size, sys);
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

async function applyPlan(
  sys: SystemSettings,
  roles: Role[],
  assignments: Record<string, string>
): Promise<void> {
  const nodes = getSelectedTextNodes();
  const plan = buildPlan(nodes, sys, roles, assignments);
  if (plan.length === 0) return;

  // 1. Type properties.
  for (const item of plan) {
    const node = item.node;
    await loadFontsForNode(node);

    // Optional weight override — only if the family actually has that style.
    if (item.role.overrides.weight && node.fontName !== figma.mixed) {
      const fam = (node.fontName as FontName).family;
      const candidate: FontName = { family: fam, style: item.role.overrides.weight };
      try {
        await figma.loadFontAsync(candidate);
        node.fontName = candidate;
      } catch (e) {
        // Style unavailable; leave the font as-is.
      }
    }

    node.fontSize = item.size;

    if (item.lineHeight != null) {
      node.lineHeight = { value: item.lineHeight * 100, unit: "PERCENT" };
    }
    if (item.trackingPct != null) {
      node.letterSpacing = { value: item.trackingPct, unit: "PERCENT" };
    }
    if (item.role.overrides.textCase) {
      node.textCase = item.role.overrides.textCase;
    }
  }

  // 2. Spacing — re-stack assigned layers top->bottom.
  if (!sys.spacingEnabled || plan.length < 2) return;

  const ordered = plan.slice().sort((a, b) => a.node.y - b.node.y);
  const parent = ordered[0].node.parent;
  const sameAutoLayoutParent =
    parent &&
    "layoutMode" in parent &&
    (parent as FrameNode).layoutMode !== "NONE" &&
    ordered.every((it) => it.node.parent === parent);

  if (sameAutoLayoutParent) {
    // Auto-layout supports a single gap; use the smallest assigned size as the
    // representative lower element.
    const smallest = ordered.reduce((m, it) => Math.min(m, it.size), Infinity);
    (parent as FrameNode).itemSpacing = computeGap(smallest, sys);
  } else {
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1].node;
      const curr = ordered[i].node;
      const gap = ordered[i].gapAbove != null ? (ordered[i].gapAbove as number) : computeGap(ordered[i].size, sys);
      curr.y = prev.y + prev.height + gap;
    }
  }
}

// ---------------------------------------------------------------------------
// UI messaging + persistence
// ---------------------------------------------------------------------------

const STATE_KEY = "ts2-state";
const PRESETS_KEY = "ts2-presets";

let currentSystem: SystemSettings = clone(DEFAULT_SYSTEM);
let currentRoles: Role[] = defaultRoles();

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function sendSelection(): void {
  const nodes = getSelectedTextNodes();
  figma.ui.postMessage({
    type: "selection",
    layers: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      currentSize: Math.round(representativeSize(n) * 10) / 10,
    })),
    suggestions: suggestRoles(nodes),
  });
}

function sendComputed(
  sys: SystemSettings,
  roles: Role[],
  assignments: Record<string, string>
): void {
  const nodes = getSelectedTextNodes();
  const plan = buildPlan(nodes, sys, roles, assignments);
  figma.ui.postMessage({
    type: "computed",
    items: plan.map((p) => ({
      id: p.node.id,
      roleId: p.role.id,
      size: p.size,
      lineHeight: p.lineHeight,
      trackingPct: p.trackingPct,
      gapAbove: p.gapAbove,
    })),
  });
}

async function loadPresets(): Promise<Record<string, PersistState>> {
  const presets = await figma.clientStorage.getAsync(PRESETS_KEY);
  return presets || {};
}

async function persistState(): Promise<void> {
  await figma.clientStorage.setAsync(STATE_KEY, {
    system: currentSystem,
    roles: currentRoles,
  });
}

figma.showUI(__html__, { width: 360, height: 640, themeColors: true });

figma.ui.onmessage = async (msg: any) => {
  switch (msg.type) {
    case "ready": {
      // Sweep any badges left behind by a previous (crashed) session.
      try {
        const orphans = figma.currentPage.findAll(
          (n) => n.getPluginData("tsBadge") === "1"
        );
        for (const o of orphans) {
          try {
            o.remove();
          } catch (e) {
            /* ignore */
          }
        }
      } catch (e) {
        /* ignore */
      }
      const saved: PersistState | undefined = await figma.clientStorage.getAsync(STATE_KEY);
      if (saved && saved.system && saved.roles) {
        currentSystem = { ...clone(DEFAULT_SYSTEM), ...saved.system };
        currentSystem.leading = { ...DEFAULT_SYSTEM.leading, ...saved.system.leading };
        currentRoles = saved.roles;
      }
      const presets = await loadPresets();
      figma.ui.postMessage({
        type: "init",
        system: currentSystem,
        roles: currentRoles,
        presets: Object.keys(presets),
      });
      sendSelection();
      return;
    }

    case "preview": {
      currentSystem = msg.system;
      currentRoles = msg.roles;
      sendComputed(msg.system, msg.roles, msg.assignments || {});
      return;
    }

    case "apply": {
      currentSystem = msg.system;
      currentRoles = msg.roles;
      await applyPlan(msg.system, msg.roles, msg.assignments || {});
      await persistState();
      sendComputed(msg.system, msg.roles, msg.assignments || {});
      await drawBadges(msg.assignments || {}); // re-pin badges after layout moves
      return;
    }

    case "sync-badges": {
      if (typeof msg.showBadges === "boolean") showBadges = msg.showBadges;
      if (msg.roles) currentRoles = msg.roles;
      if (msg.system) currentSystem = msg.system;
      await drawBadges(msg.assignments || {});
      return;
    }

    case "save-preset": {
      const presets = await loadPresets();
      presets[msg.name] = { system: msg.system, roles: msg.roles };
      await figma.clientStorage.setAsync(PRESETS_KEY, presets);
      figma.ui.postMessage({ type: "presets", names: Object.keys(presets) });
      return;
    }

    case "load-preset": {
      const presets = await loadPresets();
      const preset = presets[msg.name];
      if (preset) {
        currentSystem = { ...clone(DEFAULT_SYSTEM), ...preset.system };
        currentSystem.leading = { ...DEFAULT_SYSTEM.leading, ...preset.system.leading };
        currentRoles = preset.roles;
        await persistState();
        figma.ui.postMessage({
          type: "preset-loaded",
          system: currentSystem,
          roles: currentRoles,
        });
      }
      return;
    }

    case "delete-preset": {
      const presets = await loadPresets();
      delete presets[msg.name];
      await figma.clientStorage.setAsync(PRESETS_KEY, presets);
      figma.ui.postMessage({ type: "presets", names: Object.keys(presets) });
      return;
    }

    case "resize": {
      figma.ui.resize(
        Math.max(320, Math.round(msg.width)),
        Math.max(400, Math.round(msg.height))
      );
      return;
    }
  }
};

figma.on("selectionchange", () => sendSelection());
figma.on("close", () => clearBadges());
