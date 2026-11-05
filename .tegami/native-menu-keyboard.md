---
"@worksplit/react": patch
---

# Preserve native group-menu keyboard controls

Extend the exact FlexLayout correction so native color swatches support arrow-key focus and
Home/End. Embedded inputs and buttons retain their native editing and Enter/Space activation
instead of activating the surrounding menu row. Escape and Tab still dismiss the menu.

The delivered native installer checks the corrected runtime hash. Independent native Node and
production browser fixtures cover palette focus, button activation, dismissal and focus return.
