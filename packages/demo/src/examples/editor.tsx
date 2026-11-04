import { useContent, useContentController } from "@worksplit/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  createEditorPersistence,
  decideEditorLeave,
  EditorStore,
  type EditorLeaveChoice,
  type EditorLeavePrompt,
  type EditorPersistence,
  type EditorSnapshot,
} from "./editor-store";

let defaultPersistence: EditorPersistence | undefined;
function browserPersistence() {
  if (!defaultPersistence) {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* A memory saved copy also works in restricted embeds. */
    }
    defaultPersistence = createEditorPersistence(storage ? { storage } : {});
  }
  return defaultPersistence;
}

interface Prompt {
  readonly id: number;
  readonly snapshot: EditorSnapshot;
  finish(choice: EditorLeaveChoice): void;
  registerDialog(close: () => void): (() => void) | undefined;
}

/** Every overlapping request gets its own cancelable prompt and its own pause reference. */
function useLeavePrompt() {
  const queue = useRef<Prompt[]>([]);
  const nextId = useRef(0);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      // finish removes itself; cancel every request from the original queue exactly once.
      const pending = queue.current.slice();
      for (const prompt of pending) prompt.finish("cancel");
    };
  }, []);
  const ask = useCallback<EditorLeavePrompt>(
    (snapshot, signal) =>
      new Promise((resolve) => {
        if (signal.aborted || !active.current) {
          resolve("cancel");
          return;
        }
        let settled = false;
        let closeDialog: (() => void) | undefined;
        const cancel = () => prompt.finish("cancel");
        const prompt: Prompt = {
          id: ++nextId.current,
          snapshot,
          registerDialog(close) {
            if (settled) return;
            closeDialog = close;
            return () => {
              if (closeDialog === close) closeDialog = undefined;
            };
          },
          finish(choice) {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", cancel);
            // Close the native dialog before settling so its focus return cannot override navigation.
            closeDialog?.();
            queue.current = queue.current.filter((item) => item !== prompt);
            if (active.current) setPrompts([...queue.current]);
            resolve(choice);
          },
        };
        signal.addEventListener("abort", cancel, { once: true });
        queue.current.push(prompt);
        setPrompts([...queue.current]);
      }),
    [],
  );
  return { ask, prompt: prompts[0] };
}

function LeaveDialog({ prompt, resource }: { prompt: Prompt; resource: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const unregister = prompt.registerDialog(() => dialog.close());
    if (!unregister) return;
    dialog.showModal();
    return () => {
      unregister();
      dialog.close();
    };
  }, [prompt]);
  // A batch can ask a hidden tab first. The prompt must stay visible outside that tab's DOM.
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        prompt.finish("cancel");
      }}
      style={{ maxWidth: 440, padding: 24 }}
    >
      <h2 id={titleId}>Leave {resource}?</h2>
      <p>Draft {prompt.snapshot.draftVersion} has unsaved changes.</p>
      <p>Saving may finish after you type again. Those newer edits will keep this editor open.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => prompt.finish("save")}>
          Save and leave
        </button>
        <button type="button" onClick={() => prompt.finish("discard")}>
          Leave without saving
        </button>
        <button type="button" autoFocus onClick={() => prompt.finish("cancel")}>
          Keep editing
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

interface EditorContextValue {
  editor: EditorStore;
  input: RefObject<HTMLTextAreaElement | null>;
}
// undefined means a missing owner; null means this owner's accepted route is read-only.
const EditorContext = createContext<EditorContextValue | null | undefined>(undefined);

/** Keep this owner at the document's persistent root, outside its switching route outlet.
 * resource comes from accepted route matches; null explicitly declares a read-only page.
 * A tool can use the same owner with a fixed resource and <Editor /> as its child.
 */
export function EditorDocument({
  resource,
  persistence,
  children,
}: {
  resource: string | null;
  persistence?: EditorPersistence;
  children: ReactNode;
}) {
  const content = useContent();
  const editor = useMemo(
    () =>
      resource === null ? null : new EditorStore(resource, persistence ?? browserPersistence()),
    // oxlint-disable-next-line react/memo-dependencies, react-hooks/exhaustive-deps -- A new content handle owns a fresh draft even when resource and persistence are unchanged.
    [content, resource, persistence],
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const context = useMemo(() => (editor ? { editor, input } : null), [editor]);
  const { ask, prompt } = useLeavePrompt();
  useContentController(
    editor
      ? {
          title: editor.resource,
          leave: {
            getState: editor.getLeaveState,
            decide: (request) => decideEditorLeave(editor, request, ask),
          },
          async save() {
            const result = await editor.save();
            if (result.status === "failed") throw result.error;
            if (result.status === "denied") throw new Error(`Save unavailable: ${result.reason}`);
          },
          focus: () => input.current?.focus({ preventScroll: true }),
        }
      : { leave: null },
  );
  return (
    <EditorContext.Provider value={context}>
      {children}
      {prompt && editor && (
        <LeaveDialog key={prompt.id} prompt={prompt} resource={editor.resource} />
      )}
    </EditorContext.Provider>
  );
}

/** Route UI borrows its persistent owner's store and never registers a second controller. */
export function Editor() {
  const context = useContext(EditorContext);
  if (context === undefined) throw new Error("Editor must render under an EditorDocument");
  // A native pending route can render this leaf before resolvedLocation accepts its resource.
  // Keep the persistent owner's previous leave contract and wait for the accepted editor.
  return context ? <EditorView context={context} /> : null;
}

function EditorView({ context }: { context: EditorContextValue }) {
  const { editor, input } = context;
  const resource = editor.resource;
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const [failureRequest, setFailureRequest] = useState<{
    editor: EditorStore;
    saveAttempt: number;
  } | null>(null);
  const failureRequested =
    failureRequest?.editor === editor && failureRequest.saveAttempt === snapshot.saveAttempt;
  const dirty = snapshot.text !== snapshot.savedText;
  return (
    <section
      aria-label={`Editor ${resource}`}
      style={{
        padding: 20,
        display: "grid",
        gap: 12,
        height: "100%",
        boxSizing: "border-box",
        overflow: "auto",
      }}
    >
      <h1 style={{ margin: 0 }}>{resource}</h1>
      <label>
        Text
        <textarea
          ref={input}
          value={snapshot.text}
          disabled={snapshot.pauseCount > 0}
          onChange={(event) => {
            editor.edit(event.currentTarget.value);
          }}
          style={{ display: "block", width: "100%", minHeight: 160, boxSizing: "border-box" }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={snapshot.pendingWrite || snapshot.pauseCount > 0}
          onClick={() => {
            void editor.save();
          }}
        >
          {snapshot.pendingWrite ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={snapshot.pendingWrite || snapshot.pauseCount > 0 || failureRequested}
          onClick={() => {
            editor.persistence.failNextWrite();
            setFailureRequest({ editor, saveAttempt: snapshot.saveAttempt });
          }}
        >
          Fail the next save
        </button>
      </div>
      <p role="status" style={{ margin: 0 }}>
        {snapshot.pauseCount ? `Editing paused for ${snapshot.pauseCount} leave request(s). ` : ""}
        {dirty ? "Unsaved changes. " : "Saved. "}
        {snapshot.pendingWrite ? "The submitted version is saving; you can keep typing. " : ""}
        {failureRequested ? "The next save will fail. " : ""}
        Saved copy: {editor.persistence.description}.
      </p>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <details>
        <summary>Saved text</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{snapshot.savedText || "(empty)"}</pre>
      </details>
    </section>
  );
}
