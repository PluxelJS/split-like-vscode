---
"@worksplit/react": patch
---

# Preserve native docking when the viewport shrinks

Remove automatic maximize, the narrow document selector and the extra resize/Store controller.
Workbench retains the native layout and maximize choice at every viewport size. Snapshots record
the actual native Model; no desktop-preference overlay or new mobile API is introduced.

Applications and users can explicitly maximize through FlexLayout's existing Actions and controls.
Navigation styling belongs to the application; the demo keeps its sidebar CSS there. Small-window
tests verify native layout, input and resource retention rather than claiming phone/touch docking.
