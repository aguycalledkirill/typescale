# Type Scale — Figma plugin

Build a coherent, repeatable typographic system and apply it to your selected
text layers. Assign each layer a **role** (Headline, Body, Eyebrow…), and the
plugin sizes, spaces, and optically tunes every layer from one shared system.
Audition ratios and curves live; undo with Cmd/Ctrl+Z.

## What it does

- **Roles ("what is what")** — select any number of text layers and the plugin
  **detects each one's role from its actual size** (nearest role on the scale), so a
  16px paragraph reads as Body and a 48px line as Display. Each detected role shows
  as a **color badge on canvas** plus a matching chip in the panel; swap any that's
  wrong via the dropdown and your choice sticks. Roles are fully custom (name + scale
  step + optional overrides) and seeded with a deletable starter set.
- **Modular scale** — each role sits on a step: `size = baseSize × ratio^step`.
  Named ratios (minor second → golden) plus a custom slider.
- **Optical leading** — line height interpolates from a body value at the base size
  to a tighter display value at large sizes (tighter for big text, looser for
  body).
- **Optical tracking** — letter spacing follows the Inter "Dynamic Metrics" curve
  (`-0.0223 + 0.185·e^(-0.1745·size)` em): negative at display sizes, positive for
  small text. A strength control scales it.
- **Spacing** — re-stacks the layers with either a **baseline grid** gap (multiples
  of a base unit) or a **size-proportional** gap. Drives auto-layout `itemSpacing`
  when the layers share an auto-layout parent.
- **Per-role overrides** — line height, tracking, font weight, and text case can be
  pinned per role, overriding the curves.
- **Presets** — save the whole system (scale, curves, spacing, roles) and re-apply
  it to any selection. Everything persists locally via `clientStorage`.

Everything is applied live as you adjust controls (debounced); `Cmd/Ctrl+Z` undoes.

## How sizing works

- The **base size** is the size of a role at step 0 (typically Body).
- A role at step `n` is `baseSize × ratio^n`, rounded to your chosen precision.
- Line height (multiplier) and tracking (percent, where 1em = 100%) are computed
  from the size via the optical curves, unless the role overrides them.

## Develop

```bash
npm install
npm run build      # produces code.js
npm run watch      # rebuild on change
npm run typecheck  # type-check only
```

## Load in Figma

1. `npm install && npm run build` (or use the pre-built `code.js`).
2. Figma desktop app: **Plugins → Development → Import plugin from manifest…** and
   select `manifest.json`.
3. Select text layers and run **Plugins → Development → Type Scale**.

## Files

- `manifest.json` — plugin manifest.
- `code.ts` — main thread: scale math, roles, optical curves, apply, persistence.
- `code.js` — bundled output loaded by Figma (built from `code.ts`).
- `ui.html` — the plugin panel UI.

## Not included (yet)

Figma text styles, design-token / JSON / CSS export, and per-transition spacing
(different gaps eyebrow→headline vs headline→body) are deliberately out of scope —
straightforward follow-ups if wanted.
