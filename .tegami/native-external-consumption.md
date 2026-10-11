---
"@worksplit/core": patch
"@worksplit/react": major
---

# Expose native host customization and reopen registered tools

Workbench accepts standard root DOM props and a direct FlexLayout `Ref<ILayoutApi>`.
Application styling owns its colors; native render slots, themes and Router providers remain
the customization path. Guarded mutations remain intercepted, so use dispatcher receipts rather
than native ref insertion return values.

Registered tools may enter or re-enter with a single native `Actions.addTab`; `close(id)` handles
both documents and tools. Native JSON owns their titles: remove the unused registration `title`.
Reject tool/document identity conflicts and stale lifecycle registrations after reopening.
Tool admission under `allowDrop` and multi-leaf insertion batches are explicitly unsupported.

Provisional document admission defers foreground selection until docking approval. Refusal or
a thrown policy cleans up the candidate and restores retained native selection; a native observer
that also blocks cleanup produces an explicit failure with the retained provisional id.

Keep emitted declaration source-map references backed by files, and verify packed exports,
strict frontend types, native customization and build in an independently installed consumer.
