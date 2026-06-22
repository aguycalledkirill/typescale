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
    leading: { enabled: true, bodyLH: 1.5, displayLH: 1, displaySize: 48 },
    trackingEnabled: true,
    trackingStrength: 1,
    spacingEnabled: true,
    spacingMode: "proportional",
    baseUnit: 8,
    spacingAmount: 0.5
  };
  function emptyOverrides() {
    return { lineHeight: null, trackingPct: null, weight: null, textCase: null };
  }
  function defaultRoles() {
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
        overrides: { lineHeight: null, trackingPct: 8, weight: null, textCase: "UPPER" }
      },
      { id: "r-caption", name: "Caption", step: -1, overrides: emptyOverrides() }
    ];
  }
  var TRACK_A = -0.0223;
  var TRACK_B = 0.185;
  var TRACK_C = -0.1745;
  function roundTo(value, step) {
    if (!step || step <= 0) return value;
    return Math.round(value / step) * step;
  }
  function computeSize(step, sys) {
    return roundTo(sys.baseSize * Math.pow(sys.ratio, step), sys.rounding);
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
  function computeGap(lowerSize, sys) {
    if (sys.spacingMode === "grid") {
      return Math.round(sys.spacingAmount * sys.baseUnit);
    }
    return Math.round(sys.spacingAmount * lowerSize);
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
  function buildPlan(nodes, sys, roles, assignments) {
    const rolesById = new Map(roles.map((r) => [r.id, r]));
    const items = [];
    for (const node of nodes) {
      const roleId = assignments[node.id];
      if (!roleId) continue;
      const role = rolesById.get(roleId);
      if (!role) continue;
      const size = computeSize(role.step, sys);
      const lineHeight = role.overrides.lineHeight != null ? role.overrides.lineHeight : computeLineHeight(size, sys);
      const trackingPct = role.overrides.trackingPct != null ? role.overrides.trackingPct : computeTrackingPct(size, sys);
      items.push({ node, role, size, lineHeight, trackingPct, gapAbove: null });
    }
    if (sys.spacingEnabled && items.length > 1) {
      const ordered = items.slice().sort((a, b) => a.node.y - b.node.y);
      for (let i = 1; i < ordered.length; i++) {
        ordered[i].gapAbove = computeGap(ordered[i].size, sys);
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
      const smallest = ordered.reduce((m, it) => Math.min(m, it.size), Infinity);
      parent.itemSpacing = computeGap(smallest, sys);
    } else {
      for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1].node;
        const curr = ordered[i].node;
        const gap = ordered[i].gapAbove != null ? ordered[i].gapAbove : computeGap(ordered[i].size, sys);
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
  figma.showUI(__html__, { width: 360, height: 640, themeColors: true });
  figma.ui.onmessage = async (msg) => {
    switch (msg.type) {
      case "ready": {
        const saved = await figma.clientStorage.getAsync(STATE_KEY);
        if (saved && saved.system && saved.roles) {
          currentSystem = __spreadValues(__spreadValues({}, clone(DEFAULT_SYSTEM)), saved.system);
          currentSystem.leading = __spreadValues(__spreadValues({}, DEFAULT_SYSTEM.leading), saved.system.leading);
          currentRoles = saved.roles;
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
      case "apply": {
        currentSystem = msg.system;
        currentRoles = msg.roles;
        await applyPlan(msg.system, msg.roles, msg.assignments || {});
        await persistState();
        sendComputed(msg.system, msg.roles, msg.assignments || {});
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
          currentSystem = __spreadValues(__spreadValues({}, clone(DEFAULT_SYSTEM)), preset.system);
          currentSystem.leading = __spreadValues(__spreadValues({}, DEFAULT_SYSTEM.leading), preset.system.leading);
          currentRoles = preset.roles;
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
})();
