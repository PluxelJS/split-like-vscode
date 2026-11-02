# Content resources and Cap’n Web

Use `useWorkbenchContent(lifecycle?)` for editing decisions and `content.effect(setup)` for
resources that must stop when their React effect or content ends. React owns dependencies;
Worksplit tracks cleanup through content close and host disposal. Shared services, drafts,
protocol rules and resource creation remain application owned. Worksplit has no runtime Cap’n Web
dependency.

Start with [content decisions](../README.md#content-decisions-commands-and-resources) for dirty
guards, save commands and shutdown.

## Choose the owner

| Resource                                               | Owner and release boundary                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Application connection, shared draft or shared service | The host; a page releases only its own reference or subscription         |
| Page capability and its subscriptions                  | One `content.effect`; end on React cleanup, manual stop or content close |
| Component-local request or visual effect               | Ordinary React effect when it need not join Worksplit close settlement   |
| Job intended to continue after closing a tab           | Application owner with its own completion and cancellation policy        |

A content can have one editing owner and several independent resource effects. Calling the hook
without a lifecycle does not claim editing ownership. Put the editing owner in the persistent
document root that decides whether the user may leave. A child route or hidden region manages
its own resources. With Activity or Suspense, React may clean effects while keeping component
state; those resources are reacquired when React runs setup again. The persistent root keeps dirty
close protection while its child is hidden. Issuing editing or close commands while Activity has
deactivated the entire editing owner is outside this contract; keep that owner outside the hidden
boundary when commands must remain available.

Native tab activation, backgrounding, movement and Border hiding do not themselves stop an effect.
Ordinary rerenders keep it when the React dependency list has not changed. StrictMode may run
setup → cleanup → setup; each setup acquires its own resources and releases its own late results.
Resources that must survive React remounting belong to an application owner, with the page holding
only a reference. Snapshots contain locations and layout, never live capabilities.

A subscription needs only the native React dependency list and a registered cleanup:

```tsx
const content = useWorkbenchContent();
useEffect(
  () => content.effect(({ defer }) => defer(service.subscribe(onChange))),
  [content, service, onChange],
);
```

## Cap’n Web example

The host installs `capnweb`, authenticates and owns the shared RPC session. Pass a stable borrowed
API stub through application props or Router context. Each `openDocument` call returns a fresh
document target; that target's server-side disposer releases its own watchers and subscriptions.
Authorization and the target implementation belong to the application.

The interfaces describe the application's RPC contract; server implementations extend `RpcTarget`.
Mount this component inside a Worksplit document or tool:

```tsx
import { useWorkbenchContent } from "@worksplit/react";
import type { RpcStub, RpcTarget } from "capnweb";
import { useEffect, useState } from "react";

interface DocumentSession extends RpcTarget {
  title(): string;
}
interface DocumentApi extends RpcTarget {
  openDocument(id: string): Promise<DocumentSession>;
}

export function DocumentPage({
  api,
  documentId,
}: {
  api: RpcStub<DocumentApi>;
  documentId: string;
}) {
  const content = useWorkbenchContent();
  const [title, setTitle] = useState("Opening document…");

  useEffect(
    () =>
      content.effect(async ({ signal, defer }) => {
        setTitle("Opening document…");
        const session = await api.openDocument(documentId);
        defer(() => session[Symbol.dispose]());
        if (signal.aborted) return;
        const title = await session.title();
        if (!signal.aborted) setTitle(title);
      }),
    [content, api, documentId],
  );

  return <p role="status">{title}</p>;
}
```

`defer` transfers cleanup responsibility immediately, including after an await. If the effect has
already ended, it immediately releases that late result. The signal check prevents an old route
from updating the current UI; a standard AbortSignal cannot guarantee cancellation of remote work.
Only cancellation corresponding to this signal's reason is a normal stop. Other failures remain
visible even after the signal has aborted.

Unhandled setup failures stop the effect, release resources already deferred, and report through
`onIssue` or the default `console.error`. A page may catch recoverable business errors inside setup
to present them inline. It does not need a general cleanup `finally` or a second error reporter.

## Stop, close and error ownership

`effect` runs setup at the call and returns an idempotent synchronous stop function, directly usable
as React cleanup. Start it inside an effect or an event handler, never during render. An event
handler's effect remains owned by the content until stop or content close; component unmount alone
does not call an event handler's stop.

Each deferred cleanup runs once. Resources already registered in the same effect release in reverse
acquisition order; failure does not skip the rest. Different effects have no ordering relationship.
Place resources with a required release order in the same effect. A late `defer` starts independent
cleanup immediately and cannot recreate a finished effect. An old content handle cannot start work
or commands after close, including when a new tab reuses the same id.

Refused, canceled or invalidated closing leaves effects and resources running. After approved
native removal, close fixes its waiting set before calling abort listeners or cleanup: all cleanup
registered at that point and earlier stop tasks still settling. Disposal does the same for its
contents. A pending setup Promise is not itself in that set. Resources or setup failures arriving
after the boundary are still cleaned and reported but do not extend that operation, even when they
arrive before its receipt. A cleanup that never settles keeps its operation pending; use the
business API's cancellation and timeout policy when completion must be bounded.

Programmatic `close`, removal `dispatch` and `dispose` return their errors for the caller to handle.
The native UI consumes its operation receipt and reports through `onIssue` once. A React stop with
no waiting operation reports cleanup errors through `onIssue`; an operation can take ownership of
unreported in-flight tasks in its waiting set. Waiting later does not report the same task twice.
Errors already reported do not reappear in a later close receipt. Without a handler, the library
uses `console.error`. A synchronously throwing handler falls back to a diagnostic containing the
original failure and the handler failure and cannot prevent remaining cleanup.

Stop starts cleanup and returns `void`; it is not a completion receipt. Use the existing host close
or dispose operation to await the defined cleanup set. Cleanup must not await an operation whose
waiting set contains that cleanup, which would create a self-dependency.

## Protocol release remains explicit

- Dispose the document stub explicitly. Cap’n Web calls the target's `Symbol.dispose` after the
  stub and its duplicates are released; GC is not the resource contract. A separate owner retaining
  a borrowed stub uses `dup()` and releases that duplicate, which can outlive the tab.
- Register separately acquired child stubs, subscription handles and retained callbacks with their
  actual owner. Releasing a root does not recursively release every capability returned by methods.
- Calling `stub[Symbol.dispose]()` is not acknowledgement of asynchronous server cleanup. If an
  acknowledgement matters, await the domain release method in one deferred cleanup, and release
  the stub in `finally`. Preserve protocol order inside that cleanup or the same effect.
- A pending open's late result is released on arrival. Close does not wait for that acquisition.
  To wait for a business task to exit, explicitly defer the task's business-defined exit Promise.
  The leave decision's signal belongs to that decision, not to a resource effect.
- The host owns the shared transport. Browser termination cannot guarantee React cleanup;
  session termination provides RPC cleanup once the transport detects it. Stub disposal alone does
  not guarantee cancellation of running server work.

See [Cap’n Web disposal](https://capnweb.com/concepts/disposal/) for stub ownership, returned-result
cleanup, retained callbacks and session termination. Re-exporting the same raw `RpcTarget` can
produce multiple disposal notifications; use fresh per-open targets for this example and follow
the upstream sharing rules when intentionally retaining targets.
