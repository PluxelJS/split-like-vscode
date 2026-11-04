import {
  createWorkbench,
  Workbench,
  useWorkbenchState,
  type WorkbenchSnapshot,
} from "@worksplit/react";
import { useState } from "react";

import { createReadOnlyRouter } from "./read-only";

const snapshotKey = "worksplit-example-layout-v2";
export function createBrowserWorkbench(onOutside: (href: string) => void) {
  const saved = localStorage.getItem(snapshotKey);
  // Invalid data is surfaced by startup. Reset is an explicit host action.
  const initial = saved === null ? undefined : { snapshot: JSON.parse(saved) as unknown };
  const instance = createWorkbench({
    createRouter: createReadOnlyRouter,
    workspaceId: "browser-example",
    ...(initial ? { initial } : {}),
    home: { mode: "route", href: "/" },
    captureSnapshotOnClose: true,
  });
  return {
    instance,
    start: () =>
      instance.start({
        browser: {
          onOutsideNavigate: ({ href, cleanup }) => {
            onOutside(href);
            void cleanup;
          },
        },
      }),
  };
}
export function clearBrowserSnapshot() {
  localStorage.removeItem(snapshotKey);
}
export type BrowserInstance = ReturnType<typeof createBrowserWorkbench>["instance"];
export function BrowserExample({ instance }: { instance: BrowserInstance }) {
  const active = useWorkbenchState(instance, (state) => state.activeDocumentId);
  const [status, setStatus] = useState("");
  function saveSnapshot(snapshot: WorkbenchSnapshot) {
    localStorage.setItem(snapshotKey, JSON.stringify(snapshot));
    setStatus("Layout saved; reload to restore.");
  }
  return (
    <section className="example-body">
      <nav className="example-toolbar" aria-label="Browser history example">
        <button
          type="button"
          onClick={() => {
            void instance.open({ to: "/read/$name", params: { name: "Balance" } });
          }}
        >
          Open balance
        </button>
        <button
          type="button"
          onClick={() => {
            void instance.open({ to: "/read/$name", params: { name: "Results" } });
          }}
        >
          Open results
        </button>
        <button type="button" onClick={() => window.history.back()}>
          Browser back
        </button>
        <button type="button" onClick={() => window.history.forward()}>
          Browser forward
        </button>
        <button
          type="button"
          disabled={!active}
          onClick={() => {
            if (active) void instance.duplicate(active);
          }}
        >
          Duplicate document
        </button>
        <button type="button" onClick={() => saveSnapshot(instance.createSnapshot())}>
          Save layout
        </button>
        <button
          type="button"
          onClick={() => {
            clearBrowserSnapshot();
            setStatus("Saved layout removed; current workspace stays open.");
          }}
        >
          Forget saved layout
        </button>
        <output aria-live="polite">{status}</output>
      </nav>
      <Workbench instance={instance} />
    </section>
  );
}
