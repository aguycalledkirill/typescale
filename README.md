# Type Scale — Figma plugin

Build a coherent, repeatable typographic system and apply it to your selected
text layers. Assign each layer a **role** (Headline, Body, Eyebrow…), and the
plugin sizes, spaces, and optically tunes every layer from one shared system.
Audition ratios and curves live; undo with Cmd/Ctrl+Z.

## What it does

- **Roles ("what is what")** — select any number of text layers and the plugin
  **detects each one's role from its actual size** (nearest role on the scale),
  so a 16px paragraph reads as Body and a 48px line as Display. Each detected role
  shows as a **colored pill on canvas** (toggleable) plus a matching chip in the
  panel; swap any that's wrong via the dropdown and your choice sticks. Roles are
  fully custom (name + scale step + label flag + optional overrides) and seeded
  with a deletable starter set.
- **Fit to selection (analyze first)** — when your layers already have sizes, the
  plugin reverse-engineers the **base size + closest named ratio** they imply
  (log-linear least-squares fit) and shows it. The **Snap to scale** slider then
  blends each layer between its *current* size (0% — micro adjustment) and the
  *canonical* scale size (100% — full, dramatic). So the first apply barely moves
  anything; push the slider when you want it to fully conform.
- **Modular scale** — each role sits on a step: `size = baseSize × ratio^step`.
  Named ratios (minor second → golden) plus a custom slider.
- **Relationship-aware spacing** — re-stacks the layers and spaces them with named
  presets (Tight / Normal / Loose / Sectioned). Roles flagged as **labels**
  (Eyebrow, Caption…) automatically **hug the heading below them** with a tight
  gap, instead of inheriting the big heading's proportional spacing. Choose a
  **baseline-grid** gap (multiples of a base unit) or a **size-proportional** gap.
  Drives auto-layout `itemSpacing` when the layers share an auto-layout parent.
- **Optical leading** — line height interpolates from a body value at the base size
  to a tighter display value at large sizes, with presets (Tight / Snug / Normal /
  Relaxed) plus numeric micro-adjust.
- **Optical tracking** — letter spacing follows the Inter "Dynamic Metrics" curve
  (`-0.0223 + 0.185·e^(-0.1745·size)` em): negative at display sizes, positive for
  small text. Presets (None / Subtle / Optical / Strong) plus a strength control.
- **Per-role overrides** — line height, tracking, font weight, and text case can be
  pinned per role, overriding the curves (e.g. Eyebrow → UPPERCASE + wide tracking).
- **System presets** — save the whole system (scale, curves, spacing, roles) and
  re-apply it to any selection. Everything persists locally via `clientStorage`.

Everything is applied live as you adjust controls (debounced); `Cmd/Ctrl+Z` undoes.

## How sizing works

- The **base size** is the size of a role at step 0 (typically Body).
- A role at step `n` is `baseSize × ratio^n`, rounded to your chosen precision.
- The final per-layer size is a log-space blend between the layer's current size
  and that canonical size, controlled by **Snap to scale** (0 = keep, 1 = full).
- Line height (multiplier) and tracking (percent, where 1em = 100%) are computed
  from the resulting size via the optical curves, unless the role overrides them.

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
- `code.ts` — main thread: scale math, fit detection, roles, optical curves,
  relationship-aware spacing, apply, persistence.
- `code.js` — bundled output loaded by Figma (built from `code.ts`).
- `ui.html` — the plugin panel UI.

## Not included (yet)

Figma text styles, design-token / JSON / CSS export, and fully per-transition
spacing (a distinct gap for every adjacent role pair) — straightforward
follow-ups if wanted.
