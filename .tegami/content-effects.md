---
"@worksplit/react": major
---

# Unify content editing and effect lifetimes

Declare editing decisions with `useWorkbenchContent(lifecycle?)` and acquire resources through
`content.effect(({ signal, defer }) => …)`. Remove the separate lifecycle hook, imperative
content registration and lifecycle disposer. Each content handle is bound to its native instance;
React replay obtains a fresh effect and late resources are immediately released.

Close and dispose wait for a fixed set of known cleanups. Programmatic errors belong to their
receipts; native UI consumes those receipts, while unclaimed effect failures use `onIssue` or
the default console reporter. Export `DispatchResult` and keep reporters from interrupting cleanup.
Native ADD eligibility no longer calls live Model serialization or fires save listeners.
