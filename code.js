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
  var DEFAULTS = {
    ratio: 1.25,
    spacing: 0.5,
    applyLineHeight: false,
    lineHeight: 1.2,
    rounding: 1
  };
  figma.showUI(__html__, { width: 320, height: 560, themeColors: true });
  function getSelectedTextNodes() {
    return figma.currentPage.selection.filter(
      (node) => node.type === "TEXT"
    );
  }
  function representativeSize(node) {
    if (node.fontSize !== figma.mixed) {
      return node.fontSize;
    }
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
  function roundTo(value, step) {
    if (!step || step <= 0) return value;
    return Math.round(value / step) * step;
  }
  function computePlan(nodes, settings) {
    const withSize = nodes.map((n) => ({ node: n, size: representativeSize(n) }));
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
        targetSize: target
      };
    });
  }
  async function applyScale(settings) {
    const nodes = getSelectedTextNodes();
    if (nodes.length < 2) return;
    const plan = computePlan(nodes, settings);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const item of plan) {
      const node = byId.get(item.id);
      if (!node) continue;
      await loadFontsForNode(node);
      node.fontSize = item.targetSize;
      if (settings.applyLineHeight) {
        node.lineHeight = {
          value: item.targetSize * settings.lineHeight,
          unit: "PIXELS"
        };
      }
    }
    const sizeById = new Map(plan.map((p) => [p.id, p.targetSize]));
    const ordered = plan.map((p) => byId.get(p.id)).filter((n) => !!n).sort((a, b) => a.y - b.y);
    const parent = ordered[0] && ordered[0].parent;
    const sameAutoLayoutParent = parent && "layoutMode" in parent && parent.layoutMode !== "NONE" && ordered.every((n) => n.parent === parent);
    if (sameAutoLayoutParent) {
      const lowerSize = sizeById.get(ordered[ordered.length - 1].id) || 16;
      parent.itemSpacing = Math.round(lowerSize * settings.spacing);
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
  function sendSelection(settings) {
    const nodes = getSelectedTextNodes();
    const plan = nodes.length >= 2 ? computePlan(nodes, settings) : [];
    figma.ui.postMessage({
      type: "selection",
      count: nodes.length,
      layers: plan.map((p) => ({
        name: p.name,
        level: p.level,
        currentSize: Math.round(p.currentSize * 10) / 10,
        targetSize: Math.round(p.targetSize * 10) / 10
      }))
    });
  }
  var currentSettings = __spreadValues({}, DEFAULTS);
  figma.ui.onmessage = async (msg) => {
    if (msg.type === "ready") {
      figma.clientStorage.getAsync("typescale-settings").then((saved) => {
        if (saved) currentSettings = __spreadValues(__spreadValues({}, DEFAULTS), saved);
        figma.ui.postMessage({ type: "settings", settings: currentSettings });
        sendSelection(currentSettings);
      });
      return;
    }
    if (msg.type === "preview" && msg.settings) {
      currentSettings = __spreadValues(__spreadValues({}, DEFAULTS), msg.settings);
      sendSelection(currentSettings);
      return;
    }
    if (msg.type === "apply" && msg.settings) {
      currentSettings = __spreadValues(__spreadValues({}, DEFAULTS), msg.settings);
      await applyScale(currentSettings);
      await figma.clientStorage.setAsync("typescale-settings", currentSettings);
      sendSelection(currentSettings);
      return;
    }
  };
  figma.on("selectionchange", () => sendSelection(currentSettings));
})();
