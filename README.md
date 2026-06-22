# Type Scale — Figma plugin

Apply a modular type scale and proportional spacing to selected text layers.

Select two or more text layers (e.g. a headline and a subheading), pick a scale
ratio, and the plugin resizes the smaller layers to step down the scale from the
largest one — and sets the vertical gap between them proportionally. Audition
different ratios and spacing live; undo with Cmd/Ctrl+Z.

## How it works

- **Anchor:** the largest selected text layer keeps its size. It's the top of
  the hierarchy (your headline).
- **Steps:** each successively smaller layer is placed one step further down the
  scale, i.e. `size = anchorSize / ratio^level`.
- **Spacing:** layers are re-stacked top-to-bottom with a gap equal to
  `spacing × (lower layer's font size)`. If the layers share an auto-layout
  parent, the parent's `itemSpacing` is set instead of moving the layers.
- **Line height (optional):** set each layer's line height to a multiple of its
  font size.
- **Rounding:** snap computed sizes to whole/half/tenth pixels, or leave exact.

### Scale ratios

| Name              | Ratio |
| ----------------- | ----- |
| Minor second      | 1.067 |
| Major second      | 1.125 |
| Minor third       | 1.200 |
| Major third       | 1.250 |
| Perfect fourth    | 1.333 |
| Augmented fourth  | 1.414 |
| Perfect fifth     | 1.500 |
| Golden ratio      | 1.618 |
| Custom            | any   |

## Develop

```bash
npm install
npm run build      # produces code.js
npm run watch      # rebuild on change
npm run typecheck  # type-check only
```

## Load in Figma

1. Run `npm install && npm run build`.
2. In the Figma desktop app: **Plugins → Development → Import plugin from
   manifest…** and select `manifest.json` in this folder.
3. Select two or more text layers and run **Plugins → Development → Type Scale**.

## Files

- `manifest.json` — plugin manifest.
- `code.ts` — main thread logic (selection, scale math, applying changes).
- `code.js` — bundled output loaded by Figma (built from `code.ts`).
- `ui.html` — the plugin panel UI.
