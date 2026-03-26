# UI Theming

> Status: directional note. The current shipped baseline is automatic system light/dark theming; manual theme settings and imported theme packs remain future work.

## Current baseline

Cue should follow the operator's browser / OS `prefers-color-scheme` automatically.

For now that baseline is intentionally simple:

- no Settings surface for theme selection yet
- owner chat, login, and share snapshot surfaces should stay visually coherent across light and dark mode
- all page-level colors should continue to flow through a small semantic CSS variable layer instead of per-component hard-coded palettes

## Deferred TODO

- keep the semantic token layer stable so future named themes can remap the same UI surfaces cleanly
- when we expand beyond light/dark, prefer importing or adapting VS Code OSS theme/token definitions instead of inventing a one-off Cue palette format
- treat a manual theme picker as a follow-up, not a prerequisite for the current baseline
- revisit PWA shell / splash theming later if we want installed-app polish to match future named themes perfectly
