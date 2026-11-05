# Worksplit migration status

As of 2026-11-05, the library, demo and independent package consumer implement the redesign.
Public contracts now live in the
[README](../../README.md), [architecture](../architecture.md),
[behavior](../vscode-workbench-behavior.md), [resources](../resource-lifetimes.md) and
[native support](../navigation-support.md). The same runnable examples are used by the demo and
independent package consumer; target API sketches must not be treated as installed capability.

Other repositories should use the [general migration guide](../migration.md). The financial
consumer's [scope and acceptance](downstream-migration.md) supplement it with that host's policies.

The consumer API review corrected preview-link background overrides, made content roles narrow
to document/tool types, and marked SplitView's borrowed layout outputs readonly. Its collapsed
separator renderer is now named `renderCollapsedSash`; the controlled visibility example handles
restore requests. The current standalone gate passed 18 tasks, including 36 browser checks each
for demo and installed packages (41 total package checks). All four code blocks from the migration
and SplitView guides also compile against the installed declarations. This review's evidence is
in the financial workspace's ignored `.artifacts/worksplit-api-review/`.

The financial migration retained local commit `6557cf8` as its library baseline and integrated
the complete native corrections into the parent's single installation. The current source passed
387 React, 25 SplitView and 13 editor-store tests, plus source, test and registered-consumer
types. The parent runs the library's own build and test tasks rather than recreating the former
core/react packages or retaining a second installation.

Snapshot startup now rebinds the current browser entry to its exact restored content id and href
with fresh lifetimes; later traversal of a stale reference still creates a new document. This
fix prevents an extra copy on every host reload without guessing among equal URLs. The React
compile cache explicitly tracks source inputs in every compound-command segment so an artifact
cache hit cannot restore an older build. Both ordinary compile and repeated cache-hit output
were checked against the exact current integration source. Worksplit's public API did not gain
a coordinator, registry or compatibility path.

The post-migration review also covered first activation of a still-lazy restored tab. Browser
publication now waits for its actual native acceptance and entry reference, including redirects;
late initialization waits while a browser visit owns publication. Refused, failed and explicitly
cancelled visits restore history and reconcile the still-active content through the existing
pending-write path. Tool focus does not discard this publication, and content focus before startup
finishes cannot cancel startup. The financial host reproduced the former 3-to-4 duplicate and
now returns to the same instance with three
documents. Its current-report shortcut also uses a normal lazy Worksplit link: the application
selects the existing report's full location, while the library owns source lifetime, reuse,
presentation and results. No public API or native patch changed for these fixes.

Native panel selection or maximization can blur the old editor to body before the activated
content receives focus. This passive observation now preserves the pending focus request and
the window's actual focus state. New outside input, pointer/key intent and window blur still
cancel it. The regression covers those boundaries without host scheduling or retry logic.

The rebuilt tarball consumer passed all 41 checks in one invocation, including JavaScript/types/CSS,
unique native objects, the shipped native
installer and its read-only capability check. Its native regression passed 46 cases in each of
ESM and CJS, plus 14 source/runtime consistency checks. SplitView also passed installation with
only its React peer. These checks use the actual installed correction, not version numbers alone.

The baseline production demo and current installed tarballs passed the same 36 browser checks across
1440×900 and 900×768, with no page errors in Chromium 156.0.8078.4. The shared examples cover
actual saved-state evidence, overlapping leave requests, native menus/dragging/focus, browser
history, restoration and resource cleanup.

Integration with the main branch's toolchain update also passed all 18 standalone verification
tasks and frozen-lockfile installation under Node 24.22.2, pnpm 11.28.10 and Vite+ 1.4.0.
The demo and packed consumer each passed those 36 browser checks using the existing WebSocket
browser service; the consumer uses standard Vite 8.3.5. Exact native peers and all four corrections
remain required. Core source and patches were unchanged by this integration. Main-branch delivery
does not publish a new registry package; consume this source or freshly built archives.

The financial checkout now uses the new dependency, content controller, browser handoff, menu
and snapshot wiring. Its actual host validation and current limits are owned by the parent
repository's `VALIDATION.md`, separately from library and tarball acceptance. The
[financial migration scope](downstream-migration.md) records that consumer's scope and acceptance
paths; old host-completion statements are not evidence for the current checkout.

This migration did not repeat the earlier performance measurements and makes no speedup
claim. The regressions exercise native lifetime release, ordinary history settlement, and query
behavior without Model serialization. The supported native versions remain exact; an upstream
upgrade still requires the unpatched/patched boundary checks described in native support.
Current logs, browser screenshots and exact artifact/source evidence are retained in the financial
workspace's ignored `.artifacts/worksplit-migration/`; baseline stabilization evidence remains in
`.artifacts/worksplit-stabilization/`. The current review, exact packed-source checks, user
WebSocket browser run and financial-host counterexamples are in `.artifacts/worksplit-post-migration/`.
Library examples are not a financial-host acceptance.

- [Scenarios and counterexamples](worksplit-redesign-scenarios.md): the consumer problems and boundaries to preserve.
- [Redesign requirements](worksplit-redesign.md): the migration acceptance matrix, design rationale and pending external scope.
- [Implementation order](worksplit-redesign-implementation.md): prerequisite and verification sequencing.
- [General migration guide](../migration.md): old-to-new APIs, changed defaults and consumer acceptance.
- [Financial migration scope](downstream-migration.md): the financial consumer's policies and acceptance.

External Pluxel Shell/Studio repositories have not been modified by this task. Their actual
install/API/lifecycle adaptation remains a migration gap, not a completed consumer.

Delivery commits the verified library changes and updates the parent's gitlink with its validated
consumers. Pushing or merging either repository requires the current task's authorization.
