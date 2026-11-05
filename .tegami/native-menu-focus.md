---
packages:
  "@worksplit/react":
    type: patch
---

## Preserve native menu theme, inline controls and keyboard scope

Render default menus inside their native layout's CSS theme scope. Native inline controls,
including group colors, dispatch without closing the popup; ordinary selected entries continue
to execute after the renderer acknowledges completed menu cleanup.

Return focus to the Worksplit root when an approved close or invalidated menu removes the
focused DOM and leaves focus on body. Preserve newer content, external input and window focus
intent, including while close decisions or menu animations are pending. Capture close focus
ownership before native mutation, so synchronous native rendering receives the same handoff.
Explicit pointer and keyboard intent in native chrome cancels deferred content focus, while
passive chrome focus continues to allow first-open focus after content mounts.
The same guarded handoff preserves keyboard scope when native maximize hides the focused
sibling pane and the browser blurs its chrome or content to body.
