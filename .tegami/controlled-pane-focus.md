---
packages:
  "@worksplit/react":
    type: patch
---

# Make controlled pane visibility available during layout effects

Render panes using the current `visible` declaration so an owner can restore focus in its layout effect without waiting for the next geometry update.
