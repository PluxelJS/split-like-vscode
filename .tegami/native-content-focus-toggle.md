---
"@worksplit/react": patch
---

# Connect native focus shortcuts across content portals

Route the current native tab panel's configured focus toggle back to FlexLayout's existing panel
handler. Documents and tools can now return keyboard focus from content to their native tab after
docking without replacing their Router, editor DOM, or draft. Respect custom or disabled native
bindings, content handlers that already prevented the event, outside dialog portals, and ordinary editor keys. Input
fields keep native container-navigation shortcuts unhandled.
