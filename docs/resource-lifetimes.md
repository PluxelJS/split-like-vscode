# Content resources and Cap’n Web

Worksplit supplies a content lifetime for documents and tools. The application owns resource
creation, shared services and protocol-specific cleanup. WebSocket clients, RPC capabilities,
subscriptions and workers can all use the same public lifecycle API; Worksplit has no Cap’n Web
dependency.

Start with [content decisions](../README.md#content-decisions-commands-and-resources) for dirty
guards, save commands and shutdown. This guide shows how to attach externally acquired resources.

## Choose the owner

| Resource                                                | Owner and release boundary                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Application connection or shared service                | The host; individual content instances borrow it                         |
| Document capability and its page-specific subscriptions | One content lifecycle; release when that registration ends               |
| Component-local request or visual effect                | The component effect; cancel or release when that effect ends            |
| Job intended to continue after closing a tab            | An application job owner with its own completion and cancellation policy |

Tab activation, backgrounding and docking position do not themselves end a content registration.
The registering component must remain mounted to retain its resources. Put a document-wide owner
in a persistent parent route when nested child routes change; put route-specific resources in the
route that owns them. Closing the tab, replacing that route or unregistering the owner releases
the corresponding resources. Layout snapshots store locations and layout, not live capabilities;
restored content acquires new resources when it loads.

Use `useWorkbenchContentLifecycle(lifecycle)` for an existing stable owner. Keep the lifecycle
object stable, and create external resources outside React render and `useMemo`. The hook preserves
the same registration across StrictMode's immediate cleanup/setup replay; it does not preserve a
resource through arbitrary unmounts or make an already disposed resource reusable.

Use `useWorkbenchContent().register(lifecycle)` when an effect needs to establish ownership before
starting asynchronous acquisition. It returns an unregister function that starts cleanup
immediately. Each content has one registered lifecycle: combine editor guards, capabilities and
subscriptions in that owner. A second registration throws, and resources acquired before a
rejected registration remain the caller's responsibility.

## Cap’n Web example

The host installs `capnweb`, authenticates and owns the shared RPC session. Pass a stable borrowed
API stub through application props or Router context. Each `openDocument` call returns a fresh
document target; that target's server-side disposer releases its own watchers and subscriptions.
Authorization and target implementation belong to the application.

This read-only route component uses only public Worksplit exports. The interfaces describe the
application's RPC contract; server implementations extend `RpcTarget`. Mount the component inside
a Worksplit document or tool, and keep `api` stable for the host session.

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
  const [status, setStatus] = useState("Opening document…");

  useEffect(() => {
    let closed = false;
    let session: RpcStub<DocumentSession> | undefined;

    // Register before starting RPC: a rejected registration acquires nothing.
    const unregister = content.register({
      dispose: () => {
        closed = true;
        const current = session;
        session = undefined;
        current?.[Symbol.dispose]();
      },
    });

    setStatus("Opening document…");
    const open = async () => {
      const opened = await api.openDocument(documentId);
      if (closed) {
        opened[Symbol.dispose](); // The tab closed while acquisition was pending.
        return;
      }
      session = opened;
      const title = await opened.title(); // A string result holds no capabilities.
      if (!closed) setStatus(title);
    };
    void open().catch((error: unknown) => {
      console.error("Document capability failed", error);
      if (!closed) setStatus("Unable to open document");
    });

    return unregister;
  }, [api, content, documentId]);

  return <p role="status">{status}</p>;
}
```

The effect acquires a fresh capability for each setup and releases it for that setup's teardown.
StrictMode can therefore open twice; the first result is released even if it arrives after the
second setup. This example prioritizes explicit acquisition ownership. To retain an existing
stable owner through immediate replay, use the lifecycle hook described above; its replay handling
does not deduplicate a separate acquisition effect.

Changing `documentId` releases the previous session and starts a new one. Ordinary rerenders and
tab activation keep the same effect. An editor should add its dirty guards and save callback to
this same registration. A child widget should borrow the owner's session rather than register a
second lifecycle for the content.

## Release and completion rules

- Dispose the document stub explicitly. Cap’n Web calls the target's `Symbol.dispose` after the
  stub and its duplicates are released; JavaScript GC is not the resource-management contract.
  A separate owner that needs to retain a borrowed stub uses `dup()` and releases that duplicate.
  Such a duplicate can extend the target's lifetime beyond the tab.
- Track separately acquired child stubs, subscription handles and retained callbacks in the
  application owner. Releasing a root is not a general recursive cleanup of every capability
  returned by its methods. Compose cleanup so one failure does not skip the remaining resources.
- Worksplit awaits a promise returned by lifecycle `dispose`, and a completed `close` reports
  `cleanupErrors`. Imperative unregister returns `void`; its cleanup failures go to the host's
  `onIssue`. A local `stub[Symbol.dispose]()` call is not an acknowledgement that asynchronous
  server cleanup has finished. If that acknowledgement matters, define and await a domain method
  in the lifecycle disposer, releasing the stub in `finally`.
- The example releases a pending open's result when it arrives; closing does not wait for that
  result. Errors from this late work are reported by the example's error handler. Cancellation,
  acquisition timeouts and whether a close must wait are application contracts. The leave
  decision's `signal` belongs to that decision, not the content's whole lifetime.
- Keep the shared transport under the host owner. A tab only releases its own resources. Browser
  termination cannot guarantee that React cleanup runs; session termination provides RPC cleanup
  once the transport detects it. Disposal does not itself guarantee cancellation of running work.

See [Cap’n Web disposal](https://capnweb.com/concepts/disposal/) for stub ownership, returned-result
cleanup, retained callbacks and session termination. In particular, repeatedly exporting the same
raw `RpcTarget` can produce multiple disposal notifications; use fresh per-open targets for this
pattern, and follow the upstream rules when intentionally sharing targets.
