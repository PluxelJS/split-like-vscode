---
"@worksplit/react": patch
---

# Resolve application-defined native tools

Add optional `resolveTool(tab)` for validated native tool admission and snapshot restoration.
Resolved tools share normal close guards and resource disposal; closing releases the definition
and reopening resolves it again. New tool admission now evaluates `allowDrop` against a detached
candidate model without exposing rejected tabs in the live layout.
