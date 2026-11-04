# Worksplit migration status

As of 2026-11-05, the library, demo and independent package consumer implement the redesign.
Public contracts now live in the
[README](../../README.md), [architecture](../architecture.md),
[behavior](../vscode-workbench-behavior.md), [resources](../resource-lifetimes.md) and
[native support](../navigation-support.md). The same runnable examples are used by the demo and
independent package consumer; target API sketches must not be treated as installed capability.

The child repository's final `workspace:verify` passed all 18 tasks, preserving the task cache.
It covers source and registered-router types, tests, formatting, lint, builds and declarations.
This full gate used the parent workspace's Vite+ 1.4.0 / Vitest 5.0.5. Separately, the final source
passed all 330 React tests, builds and types in an independent checkout using its declared
Node 24.21.0 / pnpm 11.28.2 / Vite+ 1.2.0 / Vitest 5.0.4, preserving that installation and cache.

The fresh tarball consumer passed JavaScript/types/CSS, unique native objects, the shipped native
installer and its read-only capability check. Its native regression passed 41 cases in each of
ESM and CJS, plus 14 source/runtime consistency checks. SplitView also passed installation with
only its React peer. These checks use the actual installed correction, not version numbers alone.

The production demo and installed tarballs each passed the same 36 browser checks across
1440×900 and 900×768, with no page errors in Chromium 156.0.8078.4. The shared examples cover
actual saved-state evidence, overlapping leave requests, native menus/dragging/focus, browser
history, restoration and resource cleanup.

The declared running financial host passed its own acceptance, including actual 2×2 layout,
narrow panes, keyboard/mouse/dragging, focus and resource cleanup. The parent aggregate `pnpm verify`
did not pass: its checkout guard rejected the pre-existing staged gitlink mismatch. Its remaining
standard checks were run serially. The full test task last exited with a distribution log-format
assertion failure; after normalizing ANSI/whitespace in that test, the standard distribution task
passed all three tests, and static checks/build passed again. The full test aggregate was not rerun.
Seven financial browser tests require a designated
remote service endpoint that was unavailable; they remain skipped and are not replaced by the
local production-browser or running-host results.

Both final-source measurement tasks passed their browser behavior prechecks, then measured
2/10/50/200 documents, 1,000 queries, 20 activations and complete cleanup. Ordinary queries caused
no Model serialization; the explicit final snapshot serialized once, and every started resource
was released. Source and production-bundle SHA inventories accompany the ignored results.
These are single samples on Node 24.21.0 / Chromium 156.0.8078.4, with two animation frames included
per open/activation. There is no equivalent historical baseline, accounting workload or performance
improvement claim.

- [Scenarios and counterexamples](worksplit-redesign-scenarios.md): the consumer problems and boundaries to preserve.
- [Redesign requirements](worksplit-redesign.md): the migration acceptance matrix, design rationale and pending external scope.
- [Implementation order](worksplit-redesign-implementation.md): prerequisite and verification sequencing.

External Pluxel Shell/Studio repositories have not been modified by this task. Their actual
install/API/lifecycle adaptation remains a migration gap, not a completed consumer. This task
also does not authorize upstream push, parent gitlink delivery, merge or package publication.
