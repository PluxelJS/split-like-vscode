# Worksplit migration status

As of 2026-11-05, the library, demo and independent package consumer implement the redesign.
Public contracts now live in the
[README](../../README.md), [architecture](../architecture.md),
[behavior](../vscode-workbench-behavior.md), [resources](../resource-lifetimes.md) and
[native support](../navigation-support.md). The same runnable examples are used by the demo and
independent package consumer; target API sketches must not be treated as installed capability.

The 2026-11-05 stabilization pass following `b253313` passed the library's full
`pnpm verify`: all 18 tasks, using the declared Node 24.21.0 / pnpm 11.28.2 /
Vite+ 1.2.0 / Vitest 5.0.4 in an independent installation. The final source passed
357 React, 25 SplitView and 13 editor-store tests, source and registered-consumer types,
formatting, lint, builds and declaration checks. The parent workspace's old installation
was not changed or used as proof of the new native support contract.

This pass corrected foreground intent across lazy/preview waits, background/browser isolation,
default snapshot identity, owned drop feedback, native menu translation and repeated selection
during menu exit. It also bounded preview competition to live native scopes and made native
history settlement/termination explicit for both ordinary and Router-owned use. Worksplit's
public API did not gain a new coordinator, registry or compatibility path.

The fresh tarball consumer passed JavaScript/types/CSS, unique native objects, the shipped native
installer and its read-only capability check. Its native regression passed 46 cases in each of
ESM and CJS, plus 14 source/runtime consistency checks. SplitView also passed installation with
only its React peer. These checks use the actual installed correction, not version numbers alone.

The production demo and installed tarballs each passed the same 36 browser checks across
1440×900 and 900×768, with no page errors in Chromium 156.0.8078.4. The shared examples cover
actual saved-state evidence, overlapping leave requests, native menus/dragging/focus, browser
history, restoration and resource cleanup.

The current financial checkout still uses the old API and dependency wiring. It has not been
migrated or accepted against this stabilized implementation. The previous host-completion
statement did not correspond to that checkout and must not be used as migration evidence.
The [downstream migration task](downstream-migration.md) supplies the next session's scope and
acceptance paths; the parent repository will own its actual validation in `VALIDATION.md`.

This stabilization pass did not repeat the earlier performance measurements and makes no speedup
claim. The regressions exercise native lifetime release, ordinary history settlement, and query
behavior without Model serialization. The supported native versions remain exact; an upstream
upgrade still requires the unpatched/patched boundary checks described in native support.
Logs, browser screenshots and source inventories for this pass are retained in the financial
workspace's ignored `.artifacts/worksplit-stabilization/`; they are not a financial-host acceptance.

- [Scenarios and counterexamples](worksplit-redesign-scenarios.md): the consumer problems and boundaries to preserve.
- [Redesign requirements](worksplit-redesign.md): the migration acceptance matrix, design rationale and pending external scope.
- [Implementation order](worksplit-redesign-implementation.md): prerequisite and verification sequencing.
- [Downstream migration task](downstream-migration.md): the financial consumer's execution prompt.

External Pluxel Shell/Studio repositories have not been modified by this task. Their actual
install/API/lifecycle adaptation remains a migration gap, not a completed consumer.

Delivery pushes the verified submodule commit first. The parent then updates its gitlink to that
available commit, completes its own validation, and commits and pushes the integration.
