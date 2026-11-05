/* oxlint-disable no-await-in-loop -- Installation, native mutations and acceptance run serially. */
import assert from "node:assert/strict";

/** Additional native interactions shared by the production demo and packed consumer. */
export async function checkDemoInteractions(page, { viewport, report }) {
  await page.getByRole("button", { name: "SplitView", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "Retained sidebar draft", exact: true });
  await draft.fill("Retained through collapse");
  const handle = await draft.elementHandle();
  const separator = page.getByRole("separator").first();
  const before = await separator.boundingBox();
  assert.ok(before);
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  const after = await separator.boundingBox();
  assert.ok(after);
  assert.ok(after.x > before.x);
  await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2);
  await page.mouse.down();
  await page.mouse.move(after.x + after.width / 2 + 45, after.y + after.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.ok((await separator.boundingBox()).x > after.x);
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  assert.equal(await draft.isVisible(), false);
  const revealSeparator = page.getByRole("separator", {
    name: "Reveal sidebar by dragging",
    exact: true,
  });
  await revealSeparator.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).waitFor();
  assert.equal(await draft.isVisible(), true);
  assert.equal(await draft.inputValue(), "Retained through collapse");
  assert.equal(
    await handle.evaluate(
      (node) => node === document.querySelector('[aria-label="Retained sidebar draft"]'),
    ),
    true,
  );
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  assert.equal(await draft.isVisible(), false);
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  assert.equal(await draft.inputValue(), "Retained through collapse");
  assert.equal(
    await handle.evaluate(
      (node) => node === document.querySelector('[aria-label="Retained sidebar draft"]'),
    ),
    true,
  );
  report.checks.push(
    `${viewport.width}×${viewport.height}: independently packaged SplitView pointer/keyboard resizing and controlled hide/reveal through its separator retain DOM, draft and owner state`,
  );

  await page.getByRole("button", { name: "Read-only", exact: true }).click();
  const native = await page.evaluate(async () => {
    const {
      readOnly: instance,
      native: { Actions, DockLocation },
    } = window.worksplitPublic;
    const docs = instance.getDocuments();
    const first = docs[0],
      second = docs[1];
    const accepted = async (action) => {
      const result = await instance.dispatch(action);
      if (result.status !== "applied") throw new Error(JSON.stringify(result));
    };
    await accepted(Actions.addTabToNewGroup(first.id, "Browser group", "#426b42"));
    const group = first.node.getParent();
    await accepted(Actions.moveNode(second.id, group.getId(), DockLocation.CENTER, -1));
    await accepted(Actions.renameTab(first.id, "Manual title"));
    const activation = await instance.activate(first.id);
    if (activation.status !== "applied") throw new Error(JSON.stringify(activation));
    return { first: first.id, second: second.id, group: group.getId() };
  });
  await page.getByRole("tab", { name: "Manual title", exact: true }).waitFor();
  const firstRoot = page.locator(`[data-worksplit-content="${native.first}"]`);
  const retained = await firstRoot.elementHandle();
  assert.ok(retained);
  await page.evaluate(async ({ group, first, second }) => {
    const {
      readOnly: instance,
      native: { Actions, DockLocation },
    } = window.worksplitPublic;
    const parent = instance.model.getNodeById(group).getParent();
    for (const action of [
      Actions.updateNodeAttributes(group, { opened: false }),
      Actions.updateNodeAttributes(group, { opened: true }),
      Actions.moveNode(group, parent.getId(), DockLocation.RIGHT, -1),
    ]) {
      const result = await instance.dispatch(action);
      if (result.status !== "applied") throw new Error(JSON.stringify(result));
    }
    const close = await instance.close(second);
    if (close.status !== "applied") throw new Error(JSON.stringify(close));
    if (instance.model.getNodeById(first).getParent().getId() !== group)
      throw new Error("Singleton group identity lost");
    const pin = await instance.dispatch(Actions.setTabPinned(first, true));
    if (pin.status !== "applied") throw new Error(JSON.stringify(pin));
    const pinned = await instance.close(first);
    if (pinned.status !== "denied") throw new Error("Pinned tab closed");
  }, native);
  assert.equal(await retained.evaluate((node) => node.isConnected), true);
  await page.getByRole("tab", { name: /^Manual title \(.*\)$/ }).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await page.getByRole("tab", { name: "Manual title", exact: true }).waitFor();
  report.checks.push(
    `${viewport.width}×${viewport.height}: native group creation/collapse/movement/singleton removal, manual title and pinned close retain actual content`,
  );

  await page.getByRole("button", { name: "Browser history", exact: true }).click();
  await page.getByRole("heading", { name: "Read-only workspace", exact: true }).waitFor();
  const navigation = page.getByRole("navigation", { name: "Browser history example", exact: true });
  await navigation.getByRole("button", { name: "Open balance", exact: true }).click();
  await page.getByRole("heading", { name: "Balance", exact: true }).waitFor();
  await page
    .getByRole("link", { name: "Read the other report in this document", exact: true })
    .click();
  await page.getByRole("heading", { name: "Results", exact: true }).waitFor();
  assert.ok(page.url().endsWith("/read/Results"));
  await navigation.getByRole("button", { name: "Browser back", exact: true }).click();
  await page.getByRole("heading", { name: "Balance", exact: true }).waitFor();
  await navigation.getByRole("button", { name: "Browser forward", exact: true }).click();
  await page.getByRole("heading", { name: "Results", exact: true }).waitFor();
  await navigation.getByRole("button", { name: "Save layout", exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("worksplit-example-layout-v2")),
  );
  assert.equal(saved.version, 2);
  // Reload creates new lifetimes from the exact saved JSON and current browser href.
  await page.reload();
  await page.getByRole("button", { name: "Browser history", exact: true }).click();
  await page.getByRole("heading", { name: "Results", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.worksplitPublic.browser.getActiveDocument().href),
    "/read/Results",
  );
  await page
    .getByRole("navigation", { name: "Browser history example" })
    .getByRole("button", { name: "Forget saved layout", exact: true })
    .click();
  report.checks.push(
    `${viewport.width}×${viewport.height}: attached native browser back/forward and explicit version 2 saved layout reload`,
  );
}
