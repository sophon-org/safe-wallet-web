# SVG pitfalls when bringing a network's brand SVGs

`networks/<id>/public/images/` ships up to four SVGs:

| File | Use |
| --- | --- |
| `logo-no-text.svg`, `logo-round.svg` | round/square brand mark only |
| `logo-text.svg`, `logo.svg`          | full lockup (mark + wordmark) |

The Safe Wallet inlines these into the page DOM. Two failure modes are common when SVGs come straight from Adobe Illustrator (`File → Export → SVG`):

## Pitfall 1: generic gradient IDs collide between inlined SVGs

Illustrator emits IDs like:

```xml
<linearGradient id="linear-gradient" ...>
<linearGradient id="linear-gradient-2" ...>
```

When several SVGs with these IDs are inlined into the same page, every `fill="url(#linear-gradient)"` resolves to whichever `<linearGradient>` was defined **last** in document order — usually some other Safe Wallet SVG, not yours. Result: the icon is filled with the wrong gradient (or nothing) and visually disappears.

**Fix:** namespace every gradient ID with a network-unique prefix.

```bash
sed -i 's/linear-gradient/<network>-linear-gradient/g' <svg-file>
```

This rewrites both `id="..."`, `xlink:href="#..."`, and `fill: url(#...)` references in one pass, because the substring is unique. Verify with `grep "linear-gradient"` after — only `<network>-linear-gradient*` entries should remain.

`scripts/sanitize-svgs.sh` automates this across all four logo files.

## Pitfall 2: gradient stops fade into the dark UI background

Illustrator-exported gradients sometimes have one stop at the brand color and another at near-black:

```xml
<linearGradient id="...">
  <stop offset="0" stop-color="#38ff9c" />   <!-- brand green -->
  <stop offset="1" stop-color="#171717" />   <!-- near-black, ~invisible on dark sidebar -->
</linearGradient>
```

On the Safe Wallet's dark sidebar (`#171717`-ish), the second stop is the same color as the background. Result: only a thin sliver of brand color is visible at one edge of the icon — looks like the icon vanished.

**Fix:** replace the gradient fills with the solid brand color.

```bash
# 1. Find the brand color (the non-dark gradient stop) — usually obvious from logo-no-text.svg
# 2. Replace url() fills in logo-text.svg / logo.svg with the solid color
sed -i -E 's|fill: url\(#[^)]*\)|fill: #38ff9c|g' <svg-file>
```

Note: `logo-no-text.svg` and `logo-round.svg` typically already use solid fills (because they're meant to render on any background) — only the *text-bearing* logos need this fix.

`scripts/sanitize-svgs.sh` does both pitfalls in one pass when given a brand color.

## Verifying the fix

After patching, the SVG should render the icon as a solid brand-colored mark. Quick eyeball:

```bash
# spin up the dev server
cd <wallet-clone>
yarn workspace @safe-global/web dev
# open http://localhost:3000 — sidebar header should show icon next to brand name
```

The DevTools `Elements` tab is the fastest way to confirm: inspect the inlined `<svg>`, check that:
- `<linearGradient id="...">` defs all carry the `<network>-` prefix
- `<path>` elements use `fill: <hex>` (or class → `fill: <hex>`), **not** `fill: url(#...)`

## Where to apply the fix

Keep both repos in sync:

1. `networks/<id>/public/images/*.svg` in this repo (canonical source)
2. `apps/web/public/images/*.svg` in the wallet clone (the live build path; `prebuild-config.js` copies from `node_modules/safe-network-config/networks/<id>/public/images/` into here, so a stale copy persists if you only update the source)

When iterating on logos quickly during dev, edit both. After committing the source-repo fix and re-running the rollout, the wallet copy regenerates from the source.

## When the source SVGs come from a designer

Some network teams hand over Illustrator/Figma exports that have *both* pitfalls. Always run sanitize-svgs.sh on freshly imported SVGs, even if they look fine in a file preview — the rendering issue only appears once the SVGs are inlined alongside the Safe Wallet's other SVGs.
