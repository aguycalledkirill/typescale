"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // code.ts
  var DEFAULT_SYSTEM = {
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
    spacingPreset: "normal"
  };
  function emptyOverrides() {
    return { lineHeight: null, trackingPct: null, weight: null, textCase: null };
  }
  function defaultRoles() {
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
        overrides: { lineHeight: null, trackingPct: 8, weight: null, textCase: "UPPER" }
      },
      { id: "r-caption", name: "Caption", step: -1, isLabel: true, overrides: emptyOverrides() }
    ];
  }
  var NAMED_RATIOS = [1.067, 1.125, 1.2, 1.25, 1.333, 1.414, 1.5, 1.618];
  var TRACK_A = -0.0223;
  var TRACK_B = 0.185;
  var TRACK_C = -0.1745;
  var LABEL_HUG_FACTOR = 0.4;
  function roundTo(value, step) {
    if (!step || step <= 0) return value;
    return Math.round(value / step) * step;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function logLerp(cur, target, t) {
    if (cur <= 0) return target;
    if (target <= 0) return cur;
    return Math.exp(lerp(Math.log(cur), Math.log(target), t));
  }
  function rawSize(step, sys) {
    return sys.baseSize * Math.pow(sys.ratio, step);
  }
  function computeSnappedSize(step, currentSize, sys) {
    const target = rawSize(step, sys);
    if (sys.snapStrength >= 0.999) return roundTo(target, sys.rounding);
    if (sys.snapStrength <= 1e-3) return roundTo(currentSize, sys.rounding);
    return roundTo(logLerp(currentSize, target, sys.snapStrength), sys.rounding);
  }
  function computeLineHeight(size, sys) {
    const l = sys.leading;
    if (!l.enabled) return null;
    const lo = Math.min(l.bodyLH, l.displayLH);
    const hi = Math.max(l.bodyLH, l.displayLH);
    let m;
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
  function computeTrackingPct(size, sys) {
    if (!sys.trackingEnabled) return null;
    const em = TRACK_A + TRACK_B * Math.exp(TRACK_C * size);
    return Math.round(sys.trackingStrength * em * 100 * 1e3) / 1e3;
  }
  function nearestNamedRatio(r) {
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
  function detectScale(points, sys) {
    const valid = points.filter((p) => p.size > 0);
    const distinctSteps = new Set(valid.map((p) => p.step));
    if (valid.length >= 2 && distinctSteps.size >= 2) {
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
      const lr = Math.log(ratio);
      const base = Math.exp(
        valid.reduce((s, p) => s + (Math.log(p.size) - p.step * lr), 0) / n
      );
      return { baseSize: Math.round(base * 2) / 2, ratio, detected: true };
    }
    if (valid.length === 1) {
      const p = valid[0];
      const base = p.size / Math.pow(sys.ratio, p.step);
      return { baseSize: Math.round(base * 2) / 2, ratio: sys.ratio, detected: true };
    }
    return { baseSize: sys.baseSize, ratio: sys.ratio, detected: false };
  }
  function getSelectedTextNodes() {
    return figma.currentPage.selection.filter(
      (node) => node.type === "TEXT"
    );
  }
  function representativeSize(node) {
    if (node.fontSize !== figma.mixed) return node.fontSize;
    const segments = node.getStyledTextSegments(["fontSize"]);
    if (segments.length === 0) return 16;
    return segments.reduce((max, seg) => Math.max(max, seg.fontSize), 0);
  }
  async function loadFontsForNode(node) {
    if (node.characters.length === 0) {
      if (node.fontName !== figma.mixed) {
        await figma.loadFontAsync(node.fontName);
      }
      return;
    }
    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
  }
  var badgeNodes = [];
  var showBadges = true;
  function hslToRgb(h, s, l) {
    const k = (n) => (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return { r: f(0), g: f(8), b: f(4) };
  }
  function roleColor(roleId) {
    let h = 0;
    for (let i = 0; i < roleId.length; i++) h = h * 31 + roleId.charCodeAt(i) >>> 0;
    return hslToRgb(h % 360 / 360, 0.68, 0.45);
  }
  function clearBadges() {
    for (const b of badgeNodes) {
      try {
        b.remove();
      } catch (e) {
      }
    }
    badgeNodes = [];
  }
  async function drawBadges(assignments) {
    clearBadges();
    if (!showBadges) return;
    const nodes = getSelectedTextNodes();
    if (nodes.length === 0) return;
    let font = { family: "Inter", style: "Medium" };
    try {
      await figma.loadFontAsync(font);
    } catch (e) {
      font = { family: "Roboto", style: "Regular" };
      try {
        await figma.loadFontAsync(font);
      } catch (e2) {
        return;
      }
    }
    const rolesById = new Map(currentRoles.map((r) => [r.id, r]));
    for (const node of nodes) {
      const role = rolesById.get(assignments[node.id]);
      if (!role) continue;
      const box = node.absoluteBoundingBox;
      if (!box) continue;
      const badge = figma.createFrame();
      badge.name = "\u27E6 type badge \u27E7";
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
      label.characters = role.isLabel ? role.name + " \xB7" : role.name;
      label.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      badge.appendChild(label);
      figma.currentPage.appendChild(badge);
      badge.x = Math.round(box.x);
      badge.y = Math.round(box.y - badge.height - 4);
      badge.locked = true;
      badgeNodes.push(badge);
    }
  }
  function gapBetween(upper, lower, sys) {
    if (sys.spacingMode === "grid") {
      const g = sys.spacingAmount * sys.baseUnit;
      return Math.round(upper.role.isLabel ? Math.max(g * 0.5, sys.baseUnit / 2) : g);
    }
    if (upper.role.isLabel) {
      return Math.round(LABEL_HUG_FACTOR * upper.size);
    }
    return Math.round(sys.spacingAmount * lower.size);
  }
  function buildPlan(nodes, sys, roles, assignments) {
    const rolesById = new Map(roles.map((r) => [r.id, r]));
    const items = [];
    for (const node of nodes) {
      const roleId = assignments[node.id];
      if (!roleId) continue;
      const role = rolesById.get(roleId);
      if (!role) continue;
      const size = computeSnappedSize(role.step, representativeSize(node), sys);
      const lineHeight = role.overrides.lineHeight != null ? role.overrides.lineHeight : computeLineHeight(size, sys);
      const trackingPct = role.overrides.trackingPct != null ? role.overrides.trackingPct : computeTrackingPct(size, sys);
      items.push({ node, role, size, lineHeight, trackingPct, gapAbove: null });
    }
    if (sys.spacingEnabled && items.length > 1) {
      const ordered = items.slice().sort((a, b) => a.node.y - b.node.y);
      for (let i = 1; i < ordered.length; i++) {
        ordered[i].gapAbove = gapBetween(ordered[i - 1], ordered[i], sys);
      }
    }
    return items;
  }
  async function applyPlan(sys, roles, assignments) {
    const nodes = getSelectedTextNodes();
    const plan = buildPlan(nodes, sys, roles, assignments);
    if (plan.length === 0) return;
    for (const item of plan) {
      const node = item.node;
      await loadFontsForNode(node);
      if (item.role.overrides.weight && node.fontName !== figma.mixed) {
        const fam = node.fontName.family;
        const candidate = { family: fam, style: item.role.overrides.weight };
        try {
          await figma.loadFontAsync(candidate);
          node.fontName = candidate;
        } catch (e) {
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
    if (!sys.spacingEnabled || plan.length < 2) return;
    const ordered = plan.slice().sort((a, b) => a.node.y - b.node.y);
    const parent = ordered[0].node.parent;
    const sameAutoLayoutParent = parent && "layoutMode" in parent && parent.layoutMode !== "NONE" && ordered.every((it) => it.node.parent === parent);
    if (sameAutoLayoutParent) {
      let rep = 0;
      for (let i = 1; i < ordered.length; i++) {
        if (!ordered[i - 1].role.isLabel) {
          rep = gapBetween(ordered[i - 1], ordered[i], sys);
          break;
        }
      }
      if (rep === 0) rep = gapBetween(ordered[0], ordered[1], sys);
      parent.itemSpacing = rep;
    } else {
      for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1].node;
        const curr = ordered[i].node;
        const gap = ordered[i].gapAbove != null ? ordered[i].gapAbove : gapBetween(ordered[i - 1], ordered[i], sys);
        curr.y = prev.y + prev.height + gap;
      }
    }
  }
  var STATE_KEY = "ts2-state";
  var PRESETS_KEY = "ts2-presets";
  var currentSystem = clone(DEFAULT_SYSTEM);
  var currentRoles = defaultRoles();
  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }
  function normalizeSystem(saved) {
    const sys = __spreadValues(__spreadValues({}, clone(DEFAULT_SYSTEM)), saved || {});
    sys.leading = __spreadValues(__spreadValues({}, DEFAULT_SYSTEM.leading), saved && saved.leading);
    return sys;
  }
  function normalizeRoles(saved) {
    if (!Array.isArray(saved)) return defaultRoles();
    return saved.map((r) => ({
      id: r.id,
      name: r.name,
      step: r.step,
      isLabel: typeof r.isLabel === "boolean" ? r.isLabel : r.overrides && r.overrides.textCase === "UPPER" || false,
      overrides: __spreadValues(__spreadValues({}, emptyOverrides()), r.overrides || {})
    }));
  }
  function sendSelection() {
    const nodes = getSelectedTextNodes();
    figma.ui.postMessage({
      type: "selection",
      layers: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        currentSize: Math.round(representativeSize(n) * 10) / 10
      }))
    });
  }
  function sendComputed(sys, roles, assignments) {
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
        gapAbove: p.gapAbove
      }))
    });
  }
  async function loadPresets() {
    const presets = await figma.clientStorage.getAsync(PRESETS_KEY);
    return presets || {};
  }
  async function persistState() {
    await figma.clientStorage.setAsync(STATE_KEY, {
      system: currentSystem,
      roles: currentRoles
    });
  }
  figma.showUI(__html__, { width: 360, height: 660, themeColors: true });
  figma.ui.onmessage = async (msg) => {
    switch (msg.type) {
      case "ready": {
        try {
          const orphans = figma.currentPage.findAll(
            (n) => n.getPluginData("tsBadge") === "1"
          );
          for (const o of orphans) {
            try {
              o.remove();
            } catch (e) {
            }
          }
        } catch (e) {
        }
        const saved = await figma.clientStorage.getAsync(STATE_KEY);
        if (saved && saved.system && saved.roles) {
          currentSystem = normalizeSystem(saved.system);
          currentRoles = normalizeRoles(saved.roles);
        }
        const presets = await loadPresets();
        figma.ui.postMessage({
          type: "init",
          system: currentSystem,
          roles: currentRoles,
          presets: Object.keys(presets)
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
        const rolesById = new Map(msg.roles.map((r) => [r.id, r]));
        const assignments = msg.assignments || {};
        const points = [];
        for (const node of getSelectedTextNodes()) {
          const roleId = assignments[node.id];
          const role = roleId ? rolesById.get(roleId) : void 0;
          if (role) points.push({ step: role.step, size: representativeSize(node) });
        }
        const fit = detectScale(points, msg.system || currentSystem);
        figma.ui.postMessage({
          type: "fit",
          baseSize: fit.baseSize,
          ratio: fit.ratio,
          detected: fit.detected
        });
        return;
      }
      case "apply": {
        currentSystem = msg.system;
        currentRoles = msg.roles;
        await applyPlan(msg.system, msg.roles, msg.assignments || {});
        await persistState();
        sendComputed(msg.system, msg.roles, msg.assignments || {});
        await drawBadges(msg.assignments || {});
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
            roles: currentRoles
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
})();
