import { Pane, SplitView, type SplitViewHandle } from "@worksplit/split-view";
import { useRef, useState } from "react";

import "@worksplit/split-view/style.css";

export function SplitViewExample() {
  const split = useRef<SplitViewHandle>(null);
  const [visible, setVisible] = useState(true);
  const [last, setLast] = useState("Resize by pointer or focus the separator and use arrow keys.");
  return (
    <section className="example-body">
      <nav className="example-toolbar" aria-label="Split view example">
        <button type="button" onClick={() => setVisible(!visible)}>
          {visible ? "Hide" : "Show"} sidebar
        </button>
        <button type="button" onClick={() => split.current?.reset()}>
          Reset sizes
        </button>
        <output aria-live="polite">{last}</output>
      </nav>
      <SplitView
        ref={split}
        onLayout={(event) => {
          if (event.phase === "commit")
            setLast(`${event.reason}: ${Math.round(event.sizeById.sidebar ?? 0)} px sidebar`);
        }}
      >
        <Pane id="sidebar" minSize={140} defaultSize={240} visible={visible} keepMounted>
          <section style={{ padding: 16 }}>
            <h1>Sidebar</h1>
            <label>
              Retained sidebar draft{" "}
              <input aria-label="Retained sidebar draft" defaultValue="Keep my state" />
            </label>
          </section>
        </Pane>
        <Pane id="content" minSize={200} defaultSize="1fr">
          <section style={{ padding: 16 }}>
            <h1>Independent SplitView</h1>
            <p>
              Only React is needed. This package does not create a Router, Model or document
              session.
            </p>
            <textarea
              aria-label="Split content draft"
              defaultValue="Resize or collapse the sidebar; this editor stays mounted."
            />
          </section>
        </Pane>
      </SplitView>
    </section>
  );
}
