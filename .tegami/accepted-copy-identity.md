---
"@worksplit/react": patch
---

# Preserve accepted primary and copy identities during reload

Do not report a native identity conflict when an ordinary document reloads or lazily restores
beside an explicit same-URL copy. Both accepted owners remain independent. A native navigation
that changes an ordinary document into another open content identity still reports the conflict.
