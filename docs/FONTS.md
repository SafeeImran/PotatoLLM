# Fonts

The UI uses two typefaces, both loaded locally so the app works offline.

## GT Walsheim Condensed (primary)

Files:

```
apps/desktop/public/fonts/gt-walsheim-condensed-light.otf
apps/desktop/public/fonts/gt-walsheim-condensed-bold.otf
```

These are **trial versions** from GrilliType, obtained from the type foundry's trial download.
A trial licence permits evaluation only. It does not permit shipping the files in a distributed
application or a public product.

Before you distribute a build or make wide use of this repository:

1. Buy a licence for GT Walsheim Condensed from https://www.grillitype.com, or
2. Swap in a different condensed typeface. The whole app reads the family name through the CSS
   variable `--pot-sans` (and `--pot-heading-font` for the bold cut) in
   `apps/desktop/src/styles/potato.css` and `fonts.css`, so a replacement is two `@font-face`
   blocks and a variable change, or
3. Fall back to Space Grotesk (already bundled, see below) by setting the Font Style toggle in
   the app to "Grotesk", or make that the default in `hooks/useAppearance.ts`.

The repository is set up so the loose trial copies at the repo root are git ignored. The copies
under `apps/desktop/public/fonts/` are what the build loads, and they are committed so the app
runs out of the box during development. Treat them as a placeholder.

## Space Grotesk (alternate)

Files:

```
apps/desktop/public/fonts/space-grotesk-*.woff2
```

Vendored from `@fontsource/space-grotesk`. Space Grotesk is released under the
SIL Open Font License 1.1, which permits bundling and redistribution. No action needed.

## KaTeX fonts

`apps/desktop/dist/` may contain KaTeX web fonts pulled in by the math rendering in chat. Those
come from the `katex` npm package (MIT plus OFL for the fonts) and are build output, not
committed.
