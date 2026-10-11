---
"@worksplit/react": patch
---

# Preserve native FlexLayout interactions and defaults

Let native tab selection and keyboard navigation own DOM focus. Tool selection, Border collapse
and Border/tool-only batches preserve the last document URL; queued explicit content focus is
cancelled by newer selection or observed focus. Moving a selected active document preserves its
URL, while whole-group moves retain native destination selection.
Singleton native batches, including nested ones, have their leaf Action's selection/move behavior;
native Model execution and observer notifications retain the original batch.

Accept native omitted JSON fields, generated document ids and runtime attribute resets. Remove
content overflow clipping and the duplicate error boundary, retaining native scrollbars and Retry.
Keep catalogue rendering subscriptions in the narrow document selector so native adjusting resize
does not trigger extra desktop Workbench renders. Narrow maximize switching uses one native Action.
Queued narrow presentation follows the settled document owner and is cancelled on disconnect,
so it cannot overwrite a native batch's final selection or the restored desktop preference.

The demo uses native Pin and maximize controls directly. Floating, popouts, sublayouts, protected
document identity and guarded-close constraints keep their existing ownership boundaries.
