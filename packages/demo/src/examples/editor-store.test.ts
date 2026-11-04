import { describe, expect, it } from "vitest";

import {
  createEditorPersistence,
  decideEditorLeave,
  EditorStore,
  type EditorPersistence,
  type EditorSaveResult,
} from "./editor-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const saved = new Map<string, string>();
  const writes: {
    resource: string;
    text: string;
    completion: ReturnType<typeof deferred<void>>;
  }[] = [];
  const persistence: EditorPersistence = {
    description: "controlled memory",
    read: (resource) => saved.get(resource) ?? "",
    async write(resource, text) {
      const completion = deferred<void>();
      writes.push({ resource, text, completion });
      await completion.promise;
      saved.set(resource, text);
    },
    failNextWrite() {
      throw new Error("Tests reject the actual in-flight write instead.");
    },
  };
  return { editor: new EditorStore("notes", persistence), saved, writes };
}

function attempt(editor: EditorStore) {
  const abort = new AbortController();
  const cleanups: (() => void)[] = [];
  return {
    request: {
      state: editor.getLeaveState(),
      signal: abort.signal,
      defer(cleanup: () => void) {
        if (abort.signal.aborted) cleanup();
        else cleanups.push(cleanup);
      },
    },
    end() {
      abort.abort();
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

async function until(check: () => boolean) {
  // oxlint-disable-next-line no-await-in-loop -- Each microtask must observe the preceding decision before advancing.
  for (let turn = 0; turn < 20 && !check(); turn++) await Promise.resolve();
  expect(check()).toBe(true);
}

describe("public editor example", () => {
  it("persists a separate saved copy and reports an actual storage failure", async () => {
    const data = new Map<string, string>();
    let fail = false;
    const persistence = createEditorPersistence({
      delayMs: 0,
      storage: {
        getItem: (key) => data.get(key) ?? null,
        setItem(key, value) {
          if (fail) throw new Error("Quota exceeded");
          data.set(key, value);
        },
      },
    });
    const editor = new EditorStore("a/b", persistence);
    editor.edit("saved A");
    expect((await editor.save()).status).toBe("saved");
    expect(new EditorStore("a/b", persistence).getSnapshot().text).toBe("saved A");
    editor.edit("unsaved B");
    fail = true;
    expect((await editor.save()).status).toBe("failed");
    expect(editor.getLeaveState().hasUnsavedChanges).toBe(true);
    expect(editor.getSnapshot().pendingWrite).toBe(false);
    expect(persistence.read("a/b")).toBe("saved A");
  });

  it("rejects duplicate save admission and does not approve edits made while a saved version was in flight", async () => {
    const { editor, saved, writes } = fixture();
    editor.edit("A");
    const submitted = editor.getSnapshot();
    const first = editor.save();
    expect(editor.getSnapshot().pendingWrite).toBe(true);
    expect(await editor.save()).toEqual({ status: "denied", reason: "pending-write" });
    editor.edit("B");
    writes[0]!.completion.resolve();
    const result = await first;
    expect(result).toEqual({
      status: "saved",
      basis: { text: "A", draftVersion: submitted.draftVersion, token: submitted.token },
      approvalToken: null,
    });
    expect(saved.get("notes")).toBe("A");
    expect(editor.getSnapshot().text).toBe("B");
    expect(editor.getLeaveState().hasUnsavedChanges).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("settles an accepted write through a later pause while denying new edits and saves", async () => {
    const { editor, writes } = fixture();
    editor.edit("A");
    const pending = editor.save();
    const release = editor.pauseEdits(editor.getLeaveState().token)!;
    expect(editor.edit("B")).toBe(false);
    expect(await editor.save()).toEqual({ status: "denied", reason: "paused" });
    writes[0]!.completion.resolve();
    expect((await pending).status).toBe("saved");
    expect(editor.getSnapshot().pauseCount).toBe(1);
    expect(editor.getLeaveState().hasUnsavedChanges).toBe(false);
    release();
    expect(editor.edit("C")).toBe(true);
  });

  it("keeps overlapping leave references independent and never clears dirty on discard", async () => {
    const { editor } = fixture();
    editor.edit("unsaved");
    const first = attempt(editor);
    const second = attempt(editor);
    const token = editor.getLeaveState().token;
    expect(await decideEditorLeave(editor, first.request, async () => "discard")).toEqual({
      decision: "allow",
      token,
    });
    expect(await decideEditorLeave(editor, second.request, async () => "discard")).toEqual({
      decision: "allow",
      token,
    });
    expect(editor.getSnapshot().pauseCount).toBe(2);
    expect(editor.getLeaveState()).toEqual({ hasUnsavedChanges: true, token });
    first.end();
    first.end();
    expect(editor.getSnapshot().pauseCount).toBe(1);
    expect(editor.edit("blocked")).toBe(false);
    second.end();
    expect(editor.getSnapshot().pauseCount).toBe(0);
    expect(editor.edit("allowed")).toBe(true);
  });

  it("also freezes a clean editor until the actual navigation attempt ends", async () => {
    const { editor } = fixture();
    const leave = attempt(editor);
    let prompts = 0;
    const result = await decideEditorLeave(editor, leave.request, async () => {
      prompts++;
      return "cancel";
    });
    expect(result.decision).toBe("allow");
    expect(prompts).toBe(0);
    expect(editor.edit("late edit")).toBe(false);
    leave.end();
    expect(editor.edit("new edit")).toBe(true);
  });

  it("refuses a pending write even when the current text has no unsaved changes", async () => {
    const { editor, writes } = fixture();
    const save = editor.save();
    const leave = attempt(editor);
    expect(editor.getLeaveState().hasUnsavedChanges).toBe(false);
    expect((await decideEditorLeave(editor, leave.request, async () => "discard")).decision).toBe(
      "deny",
    );
    expect(editor.getSnapshot().pauseCount).toBe(0);
    writes[0]!.completion.resolve();
    await save;
  });

  it("does not approve a draft that changed while the confirmation was open, including A to B to A", async () => {
    const { editor } = fixture();
    editor.edit("A");
    const leave = attempt(editor);
    const answer = deferred<"discard">();
    const decision = decideEditorLeave(editor, leave.request, () => answer.promise);
    editor.edit("B");
    editor.edit("A");
    answer.resolve("discard");
    expect((await decision).decision).toBe("deny");
    expect(editor.getSnapshot().pauseCount).toBe(0);
  });

  it("uses the actual saved basis to approve and holds that basis through attempt completion", async () => {
    const { editor, writes } = fixture();
    editor.edit("A");
    const leave = attempt(editor);
    const decision = decideEditorLeave(editor, leave.request, async () => "save");
    await until(() => writes.length === 1);
    expect(editor.getSnapshot().pendingWrite).toBe(true);
    writes[0]!.completion.resolve();
    const result = await decision;
    expect(result).toEqual({ decision: "allow", token: editor.getLeaveState().token });
    expect(result).not.toEqual({ decision: "allow", token: leave.request.state.token });
    expect(editor.getSnapshot().pauseCount).toBe(1);
    expect(editor.edit("late B")).toBe(false);
    leave.end();
    expect(editor.getSnapshot().pauseCount).toBe(0);
  });

  it("denies leaving when a newer draft survives a successful save", async () => {
    const { editor, writes, saved } = fixture();
    editor.edit("A");
    const leave = attempt(editor);
    const decision = decideEditorLeave(editor, leave.request, async () => "save");
    await until(() => writes.length === 1);
    editor.edit("B");
    writes[0]!.completion.resolve();
    expect((await decision).decision).toBe("deny");
    expect(saved.get("notes")).toBe("A");
    expect(editor.getSnapshot().text).toBe("B");
    expect(editor.getSnapshot().pauseCount).toBe(0);
  });

  it("settles a failed leave-save and permits a later successful retry", async () => {
    const { editor, writes } = fixture();
    editor.edit("A");
    const leave = attempt(editor);
    const decision = decideEditorLeave(editor, leave.request, async () => "save");
    await until(() => writes.length === 1);
    writes[0]!.completion.reject(new Error("write failed"));
    expect((await decision).decision).toBe("deny");
    expect(editor.getSnapshot()).toMatchObject({
      pendingWrite: false,
      pauseCount: 0,
      text: "A",
      savedText: "",
    });
    const retry = editor.save();
    writes[1]!.completion.resolve();
    expect((await retry).status).toBe("saved");
  });

  it("cancels a leave request without pretending its accepted save was cancelled", async () => {
    const { editor, writes, saved } = fixture();
    editor.edit("A");
    const leave = attempt(editor);
    const decision = decideEditorLeave(editor, leave.request, async () => "save");
    await until(() => writes.length === 1);
    leave.end();
    writes[0]!.completion.resolve();
    expect((await decision).decision).toBe("deny");
    expect(saved.get("notes")).toBe("A");
    expect(editor.getSnapshot().pauseCount).toBe(0);
  });

  it("releases only its own reference when an already-ended attempt registers cleanup", async () => {
    const { editor } = fixture();
    const earlier = editor.pauseEdits(editor.getLeaveState().token)!;
    const leave = attempt(editor);
    const decision = await decideEditorLeave(
      editor,
      {
        ...leave.request,
        defer(cleanup) {
          leave.end();
          leave.request.defer(cleanup);
        },
      },
      async () => "discard",
    );
    expect(decision.decision).toBe("deny");
    expect(editor.getSnapshot().pauseCount).toBe(1);
    earlier();
    expect(editor.getSnapshot().pauseCount).toBe(0);
  });

  it("the demonstration failure control exercises the same failed write path", async () => {
    const persistence = createEditorPersistence({ delayMs: 0 });
    const editor = new EditorStore("notes", persistence);
    editor.edit("A");
    persistence.failNextWrite();
    const result: EditorSaveResult = await editor.save();
    expect(result.status).toBe("failed");
    expect(persistence.read("notes")).toBe("");
    expect((await editor.save()).status).toBe("saved");
    expect(persistence.read("notes")).toBe("A");
  });
});
