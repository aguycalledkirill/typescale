// Type Scale v3 — Figma plugin main thread.
//
// A typographic *system* you define once and re-apply to any selection:
//  - assign each selected text layer a custom ROLE ("what is what")
//  - each role sits on a modular scale step -> font size = base * ratio^step
//  - FIT TO SELECTION: detect the base + closest named ratio already present in
//    the layers, so the first adjustment is a *micro* nudge, not a jump. A
//    "snap strength" (0..1) blends each layer between its current size and the
//    canonical scale size — gentle first, dramatic on demand.
//  - line-height & letter-spacing follow optical curves + named presets
//    (Tight/Normal/Loose…), overridable per role
//  - spacing is relationship-aware: label roles (eyebrow/overline/caption) HUG
//    the heading below them; everything else uses a proportional/grid gap
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
  displayLH: number; // line-height multiplier at displaySize, e.g. 1.2
  displaySize: number; // size at/above which displayLH applies, e.g. 48
}

interface SystemSettings {
  baseSize: number;
  ratio: number;
  rounding: number;
  snapStrength: number; // 0..1 — fit blend: 0 = keep current sizes, 1 = full scale
  leading: LeadingSettings;
  leadingPreset: string; // "tight" | "snug" | "normal" | "relaxed" | "custom"
  trackingEnabled: boolean;
  trackingStrength: number; // scales the Inter tracking curve (0 = none, 1 = full)
  trackingPreset: string; // "none" | "subtle" | "optical" | "strong" | "custom"
  spacingEnabled: boolean;
  spacingMode: SpacingMode;
  baseUnit: number; // grid unit in px, e.g. 8
  spacingAmount: number; // grid: multiples of baseUnit; proportional: x lowerSize
  spacingPreset: string; // "tight" | "normal" | "loose" | "sectioned" | "custom"
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
  isLabel: boolean; // true = "hugs the element below it" (eyebrow/overline/caption)
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
  snapStrength: 0.15,
  leading: { enabled: true, bodyLH: 1.5, displayLH: 1.2, displaySize: 48 },
  leadingPreset: "normal",
  trackingEnabled: true,
  trackingStrength: 1,
  trackingPreset: "optical",
  spacingEnabled: true,
  spacingMode: "proportional",
  baseUnit: 8,
  spacingAmount: 0.75,
  spacingPreset: "normal",
};

function emptyOverrides(): RoleOverrides {
  return { lineHeight: null, trackingPct: null, weight: null, textCase: null };
}

// Seeded starter roles — fully editable/deletable by the user.
function defaultRoles(): Role[] {
  return [
    { id: "r-display", name: "Display", step: 4, isLabel: false, overrides: emptyOverrides() },
    { id: "r-headline", name: "Headline", step: 3, isLabel: false, overrides: emptyOverrides() },
    { id: "r-title", name: "Title", step: 2, isLabel: false, overrides: emptyOverrides() },
    { id: "r-subhead", name: "Subhead", step: 1, isLabel: false, overrides: emptyOverrides() },
    { id: "r-body", name: "Body", step: 0, isLabel: false, overrides: emptyOverrides() },
    {
      id: "r-eyebrow",
      name: "Eyebrow",
      step: -1,
      isLabel: true,
      overrides: { lineHeight: null, trackingPct: 8, weight: null, textCase: "UPPER" },
    },
    { id: "r-caption", name: "Caption", step: -1, isLabel: true, overrides: emptyOverrides() },
  ];
}

// Named musical ratios used both as UI presets and as snap targets for fitting.
const NAMED_RATIOS = [1.067, 1.125, 1.2, 1.25, 1.333, 1.414, 1.5, 1.618];

// Inter "Dynamic Metrics" tracking curve (em): a + b*e^(c*size).
const TRACK_A = -0.0223;
const TRACK_B = 0.185;
const TRACK_C = -0.1745;

// Spacing: label roles hug the heading below them — gap proportional to the
// (small) label's own size rather than the (large) heading's.
const LABEL_HUG_FACTOR = 0.4;

// ---------------------------------------------------------------------------
// Pure scale math
// ---------------------------------------------------------------------------

function roundTo(value: number, step: number): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Geometric (log-space) blend between current size and the canonical scale size.
function logLerp(cur: number, target: number, t: number): number {
  if (cur <= 0) return target;
  if (target <= 0) return cur;
  return Math.exp(lerp(Math.log(cur), Math.log(target), t));
}

// Raw (unrounded) canonical size for a step.
function rawSize(step: number, sys: SystemSettings): number {
  return sys.baseSize * Math.pow(sys.ratio, step);
}

function computeSize(step: number, sys: SystemSettings): number {
  return roundTo(rawSize(step, sys), sys.rounding);
}

// Final size for a node: blend its current size toward the canonical size by
// snapStrength. 0 -> keep current (micro), 1 -> full canonical (dramatic).
function computeSnappedSize(step: number, currentSize: number, sys: SystemSettings): number {
  const target = rawSize(step, sys);
  if (sys.snapStrength >= 0.999) return roundTo(target, sys.rounding);
  if (sys.snapStrength <= 0.001) return roundTo(currentSize, sys.rounding);
  return roundTo(logLerp(currentSize, target, sys.snapStrength), sys.rounding);
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

// Nearest named ratio to a detected value (used by fit-to-selection).
function nearestNamedRatio(r: number): number {
  let best = NAMED_RATIOS[0];
  let bestErr = Infinity;
  for (const cand of NAMED_RATIOS) {
    const err = Math.abs(Math.log(cand) - Math.log(r));
    if (err < bestErr) {
      bestErr = err;
      best = cand;
    }
  }
  return best;
}

// Detect the base size + closest named ratio from assigned layers.
// Each point is { step (from its role), size (current px) }.
function detectScale(
  points: { step: number; size: number }[],
  sys: SystemSettings
): { baseSize: number; ratio: number; detected: boolean } {
  const valid = points.filter((p) => p.size > 0);
  const distinctSteps = new Set(valid.map((p) => p.step));

  if (valid.length >= 2 && distinctSteps.size >= 2) {
    // Least-squares fit in log space: ln(size) = ln(base) + step * ln(ratio).
    const xs = valid.map((p) => p.step);
    const ys = valid.map((p) => Math.log(p.size));
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) * (xs[i] - mx);
    }
    const slope = den === 0 ? 0 : num / den;
    const ratio = nearestNamedRatio(Math.exp(slope));
    // Best base for the snapped ratio: geometric mean of size / ratio^step.
    const lr = Math.log(ratio);
    const base = Math.exp(
      valid.reduce((s, p) => s + (Math.log(p.size) - p.step * lr), 0) / n
    );
    return { baseSize: Math.round(base * 2) / 2, ratio, detected: true };
  }

  if (valid.length === 1) {
    // One layer: keep the current ratio, set base so this layer maps exactly.
    const p = valid[0];
    const base = p.size / Math.pow(sys.ratio, p.step);
    return { baseSize: Math.round(base * 2) / 2, ratio: sys.ratio, detected: true };
  }

  return { baseSize: sys.baseSize, ratio: sys.ratio, detected: false };
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
// On-canvas role badges
// ---------------------------------------------------------------------------

let badgeNodes: SceneNode[] = [];
let showBadges = true;

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}

// Stable per-role color from its id, so the same role always reads the same hue
// on canvas and in the panel chip (the UI mirrors this math).
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
    label.characters = role.isLabel ? role.name + " ·" : role.name;
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

// Gap between an upper element and the lower element directly below it.
function gapBetween(upper: PlanItem, lower: PlanItem, sys: SystemSettings): number {
  if (sys.spacingMode === "grid") {
    const g = sys.spacingAmount * sys.baseUnit;
    return Math.round(upper.role.isLabel ? Math.max(g * 0.5, sys.baseUnit / 2) : g);
  }
  // Proportional. A label hugs the heading below -> gap scales with the small
  // label's own size, keeping it close. Otherwise scale with the lower element.
  if (upper.role.isLabel) {
    return Math.round(LABEL_HUG_FACTOR * upper.size);
  }
  return Math.round(sys.spacingAmount * lower.size);
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

    const size = computeSnappedSize(role.step, representativeSize(node), sys);
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
      ordered[i].gapAbove = gapBetween(ordered[i - 1], ordered[i], sys);
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
    // Auto-layout supports a single uniform gap. Use the first non-label
    // proportional gap as the representative spacing.
    let rep = 0;
    for (let i = 1; i < ordered.length; i++) {
      if (!ordered[i - 1].role.isLabel) {
        rep = gapBetween(ordered[i - 1], ordered[i], sys);
        break;
      }
    }
    if (rep === 0) rep = gapBetween(ordered[0], ordered[1], sys);
    (parent as FrameNode).itemSpacing = rep;
  } else {
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1].node;
      const curr = ordered[i].node;
      const gap =
        ordered[i].gapAbove != null
          ? (ordered[i].gapAbove as number)
          : gapBetween(ordered[i - 1], ordered[i], sys);
      curr.y = prev.y + prev.height + gap;
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence + migration
// ---------------------------------------------------------------------------

const STATE_KEY = "ts2-state";
const PRESETS_KEY = "ts2-presets";

let currentSystem: SystemSettings = clone(DEFAULT_SYSTEM);
let currentRoles: Role[] = defaultRoles();

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// Bring a possibly-old persisted system up to the current shape.
function normalizeSystem(saved: any): SystemSettings {
  const sys: SystemSettings = { ...clone(DEFAULT_SYSTEM), ...(saved || {}) };
  sys.leading = { ...DEFAULT_SYSTEM.leading, ...(saved && saved.leading) };
  return sys;
}

// Old roles lack isLabel — infer it (uppercase short roles read as labels) so
// existing presets behave sensibly.
function normalizeRoles(saved: any[]): Role[] {
  if (!Array.isArray(saved)) return defaultRoles();
  return saved.map((r) => ({
    id: r.id,
    name: r.name,
    step: r.step,
    isLabel:
      typeof r.isLabel === "boolean"
        ? r.isLabel
        : (r.overrides && r.overrides.textCase === "UPPER") || false,
    overrides: { ...emptyOverrides(), ...(r.overrides || {}) },
  }));
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

figma.showUI(__html__, { width: 360, height: 660, themeColors: true });

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
        currentSystem = normalizeSystem(saved.system);
        currentRoles = normalizeRoles(saved.roles);
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

    case "fit": {
      // Detect base + nearest ratio from the currently selected+assigned layers.
      const rolesById = new Map((msg.roles as Role[]).map((r) => [r.id, r]));
      const assignments: Record<string, string> = msg.assignments || {};
      const points: { step: number; size: number }[] = [];
      for (const node of getSelectedTextNodes()) {
        const roleId = assignments[node.id];
        const role = roleId ? rolesById.get(roleId) : undefined;
        if (role) points.push({ step: role.step, size: representativeSize(node) });
      }
      const fit = detectScale(points, msg.system || currentSystem);
      figma.ui.postMessage({
        type: "fit",
        baseSize: fit.baseSize,
        ratio: fit.ratio,
        detected: fit.detected,
      });
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
        currentSystem = normalizeSystem(preset.system);
        currentRoles = normalizeRoles(preset.roles);
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
