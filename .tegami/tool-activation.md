---
packages:
  "@worksplit/react": minor
---

# Activate existing tools through the content coordinator

`activate(id)` reveals existing documents and tools, including hidden Borders and collapsed
TabGroups. Tools retain the active document and browser URL. The method returns false for missing
content or a disposed workspace; it does not recreate closed tools. Registered tool focus callbacks
use the same deferred, revocable focus request as documents, tied to the native content instance.
Mounted content waits for native panel visibility on the next frame; superseding or closing the
request cancels that scheduled frame, including while its window is hidden.
