---
"@worksplit/react": patch
---

# Preserve public Router URLs and reject incomplete saved layouts

Keep document URLs, navigation reuse, redirects and browser history in the Router's public URL
space, retaining basepath, parameters, search and hash. Parse lazily restored document locations
with that same Router before matching their identity, so changing view conditions does not admit
a duplicate document.

Require explicit node types and container children arrays in serialized snapshots before creating
the native Model. Reject incomplete candidates without rewriting them; ordinary native layout
initializers retain FlexLayout's documented defaults.
