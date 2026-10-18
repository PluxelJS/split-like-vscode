---
packages:
  "@worksplit/react":
    type: patch
---

## Synchronize controlled pane visibility with the DOM

Apply controlled pane visibility in the same React commit as the owner's layout effects. Revealed
panes no longer retain `hidden` or `inert` while split geometry settles, so owners can focus their
content immediately, including content retained with `keepMounted`.
