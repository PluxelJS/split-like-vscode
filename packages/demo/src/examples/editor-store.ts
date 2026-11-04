import type { LeaveDecision, LeaveRequest, LeaveState, LeaveToken } from "@worksplit/react";

export interface EditorPersistence {
  readonly description: string;
  read(resource: string): string;
  write(resource: string, text: string): Promise<void>;
  failNextWrite(): void;
}

const persistenceKey = (resource: string) =>
  `worksplit-example:editor:${encodeURIComponent(resource)}`;
const deny = (reason: string): LeaveDecision => ({ decision: "deny", reason });

/** The demo really saves a separate copy. Storage errors leave that copy unchanged. */
export function createEditorPersistence(
  options: {
    storage?: Pick<Storage, "getItem" | "setItem">;
    delayMs?: number;
  } = {},
): EditorPersistence {
  const memory = new Map<string, string>();
  let nextFailure = false;
  return {
    description: options.storage ? "localStorage" : "memory",
    read: (resource) =>
      options.storage?.getItem(persistenceKey(resource)) ?? memory.get(resource) ?? "",
    async write(resource, text) {
      const fail = nextFailure;
      nextFailure = false;
      await new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 350));
      if (fail)
        throw new Error("The requested demonstration save failed. The saved copy was kept.");
      if (options.storage) options.storage.setItem(persistenceKey(resource), text);
      else memory.set(resource, text);
    },
    failNextWrite() {
      nextFailure = true;
    },
  };
}

export interface EditorSnapshot {
  readonly text: string;
  readonly savedText: string;
  readonly draftVersion: number;
  readonly token: number;
  readonly pendingWrite: boolean;
  /** Increments only when a write starts, including controller/leave initiated saves. */
  readonly saveAttempt: number;
  readonly pauseCount: number;
  readonly error: string | null;
}

export interface SavedEditorBasis {
  readonly text: string;
  readonly draftVersion: number;
  /** The state actually submitted, before starting the write. */
  readonly token: number;
}

export type EditorSaveResult =
  | { status: "saved"; basis: SavedEditorBasis; approvalToken: number | null }
  | { status: "denied"; reason: "paused" | "pending-write" }
  | { status: "failed"; basis: SavedEditorBasis; error: unknown };

/** One editor's draft. UI disabling is presentation; these methods enforce admission. */
export class EditorStore {
  #snapshot: EditorSnapshot;
  #listeners = new Set<() => void>();
  #pauses = new Set<symbol>();

  constructor(
    readonly resource: string,
    readonly persistence: EditorPersistence,
  ) {
    const text = persistence.read(resource);
    this.#snapshot = {
      text,
      savedText: text,
      draftVersion: 0,
      token: 0,
      pendingWrite: false,
      saveAttempt: 0,
      pauseCount: 0,
      error: null,
    };
  }

  getSnapshot = (): EditorSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getLeaveState = (): LeaveState => ({
    hasUnsavedChanges: this.#snapshot.text !== this.#snapshot.savedText,
    token: this.#snapshot.token,
  });

  #publish(patch: Partial<EditorSnapshot>, changesState = true) {
    this.#snapshot = {
      ...this.#snapshot,
      ...patch,
      token: this.#snapshot.token + Number(changesState),
    };
    for (const listener of this.#listeners) listener();
  }

  edit(text: string): boolean {
    if (this.#pauses.size) return false;
    if (text === this.#snapshot.text) return true;
    this.#publish({ text, draftVersion: this.#snapshot.draftVersion + 1, error: null });
    return true;
  }

  /** Pause acquisition and the token comparison are synchronous. Each attempt owns one release. */
  pauseEdits(expectedToken: LeaveToken): (() => void) | undefined {
    if (this.#snapshot.token !== expectedToken) return undefined;
    const pause = Symbol("leave-attempt");
    this.#pauses.add(pause);
    this.#publish({ pauseCount: this.#pauses.size }, false);
    return () => {
      if (!this.#pauses.delete(pause)) return;
      this.#publish({ pauseCount: this.#pauses.size }, false);
    };
  }

  async save(): Promise<EditorSaveResult> {
    if (this.#pauses.size) return { status: "denied", reason: "paused" };
    if (this.#snapshot.pendingWrite) return { status: "denied", reason: "pending-write" };
    const basis: SavedEditorBasis = {
      text: this.#snapshot.text,
      draftVersion: this.#snapshot.draftVersion,
      token: this.#snapshot.token,
    };
    // Reserve before awaiting: two calls in the same turn cannot both start a write.
    this.#publish({
      pendingWrite: true,
      saveAttempt: this.#snapshot.saveAttempt + 1,
      error: null,
    });
    try {
      await this.persistence.write(this.resource, basis.text);
      // An accepted write settles even if a leave attempt has since paused this editor.
      this.#publish({ savedText: basis.text, pendingWrite: false });
      return {
        status: "saved",
        basis,
        approvalToken:
          this.#snapshot.draftVersion === basis.draftVersion ? this.#snapshot.token : null,
      };
    } catch (error) {
      this.#publish({ pendingWrite: false, error: String(error) });
      return { status: "failed", basis, error };
    }
  }
}

export type EditorLeaveChoice = "save" | "discard" | "cancel";
export type EditorLeavePrompt = (
  snapshot: EditorSnapshot,
  signal: AbortSignal,
) => Promise<EditorLeaveChoice>;

/** Used by the actual component and the protocol tests; every decision has a real implementation. */
export async function decideEditorLeave(
  editor: EditorStore,
  request: Pick<LeaveRequest, "state" | "signal" | "defer">,
  prompt: EditorLeavePrompt,
): Promise<LeaveDecision> {
  let token = request.state.token;
  if (request.signal.aborted) return deny("The leave request ended.");
  if (editor.getSnapshot().token !== token) return deny("The editor changed before the decision.");
  if (editor.getSnapshot().pendingWrite) return deny("Wait for the accepted save to settle.");
  if (request.state.hasUnsavedChanges) {
    const choice = await prompt(editor.getSnapshot(), request.signal);
    if (request.signal.aborted) return deny("The leave request ended.");
    if (editor.getSnapshot().token !== token) return deny("The editor changed while deciding.");
    if (choice === "cancel") return deny("Keep editing.");
    if (choice === "save") {
      const saved = await editor.save();
      if (saved.status !== "saved") return deny("The save did not complete.");
      // A late successful save of A cannot approve the newer draft B.
      if (saved.approvalToken === null) return deny("Newer edits were not included in that save.");
      token = saved.approvalToken;
    }
  }
  if (request.signal.aborted) return deny("The leave request ended.");
  const release = editor.pauseEdits(token);
  if (!release) return deny("The editor changed before approval.");
  try {
    request.defer(release);
  } catch (error) {
    release();
    throw error;
  }
  if (request.signal.aborted) return deny("The leave request ended.");
  // Neither discard nor approval clears the draft. Only persistence changes savedText.
  return { decision: "allow", token };
}
