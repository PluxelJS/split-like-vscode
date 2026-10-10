import { expect, test, type Page } from "@playwright/test";
import type { AnyRouter } from "@tanstack/react-router";
import type { WorkbenchInstance } from "@worksplit/react";
import type { Actions, DockLocation, IJsonModel } from "flexlayout-react";

type DispatchResult = Awaited<ReturnType<WorkbenchInstance<AnyRouter>["dispatch"]>>;
type Metrics = {
  requests: number;
  renders: number;
  mounts: number;
  unmounts: number;
  subscriptions: number;
  disposed: number;
};
declare global {
  interface Window {
    worksplitDemo: {
      workbench: WorkbenchInstance<AnyRouter>;
      Actions: typeof Actions;
      DockLocation: typeof DockLocation;
      metrics: Metrics;
      open: (id: string, target?: string, delay?: number) => Promise<unknown>;
    };
    nativeClose?: Promise<DispatchResult>;
    retainedDraft?: HTMLElement | null;
  }
}
type LayoutNode = {
  type?: string;
  id?: string;
  name?: string;
  color?: string;
  opened?: boolean;
  maximized?: boolean;
  children?: LayoutNode[];
};
function nodes(model: IJsonModel): LayoutNode[] {
  const flatten = (node: LayoutNode): LayoutNode[] => [
    node,
    ...(node.children ?? []).flatMap(flatten),
  ];
  return [model.layout, ...(model.borders ?? [])].flatMap(flatten);
}
async function layout(page: Page) {
  return page.evaluate(() => window.worksplitDemo.workbench.getLayout());
}
async function documents(page: Page) {
  return page.evaluate(() => window.worksplitDemo.workbench.getDocuments());
}
async function documentId(page: Page, name: string) {
  const document = (await documents(page)).find((value) =>
    value.href.startsWith(`/documents/${name}?`),
  );
  expect(document).toBeDefined();
  return document!.id;
}
async function activate(page: Page, name: string) {
  const id = await documentId(page, name);
  await page.evaluate((contentId) => window.worksplitDemo.workbench.activate(contentId), id);
  await expect(page.getByLabel(`Draft ${name}`, { exact: true })).toBeVisible();
  return id;
}
async function start(page: Page) {
  await page.goto("/documents/A?view=edit&delay=0");
  await expect(page.getByLabel("Draft A")).toBeVisible();
}
async function open(page: Page, name: string, target = "left") {
  await page.evaluate((request) => window.worksplitDemo.open(request.name, request.target), {
    name,
    target,
  });
  await expect(page.getByLabel(`Draft ${name}`, { exact: true })).toBeVisible();
  return documentId(page, name);
}
async function menu(page: Page, name: string) {
  const id = await documentId(page, name);
  await page.locator(`#flexlayout-tabbutton-${id}`).click({ button: "right" });
  return page.getByRole("menu", { name: "Layout actions" });
}
async function group(page: Page, name: string, title = "Research") {
  const id = await documentId(page, name);
  expect(
    await page.evaluate(
      ({ id: contentId, title: groupTitle }) => {
        const { workbench, Actions } = window.worksplitDemo;
        return workbench.dispatch(Actions.addTabToNewGroup(contentId, groupTitle, "#94b870"));
      },
      { id, title },
    ),
  ).toEqual({ status: "applied" });
  const result = nodes(await layout(page)).find(
    (node) => node.type === "tabgroup" && node.name === title,
  );
  expect(result).toBeDefined();
  return result!.id!;
}

test("native menus create, rename, color, join, remove, collapse and ungroup tabs", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").fill("A remains mounted");
  await open(page, "B");
  await page.getByLabel("Draft B").fill("B remains mounted");
  await open(page, "C");
  const before = await page.evaluate(() => ({ ...window.worksplitDemo.metrics }));
  await (await menu(page, "A")).getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename tab", exact: true }).fill("Notes A");
  await page.getByRole("textbox", { name: "Rename tab", exact: true }).press("Enter");
  await expect(page.getByRole("tab", { name: "Notes A", exact: true })).toHaveText("Notes A");
  expect(
    (await documents(page)).find((document) => document.href.includes("/documents/A")),
  ).toMatchObject({
    title: "Notes A",
  });
  await (await menu(page, "A")).getByRole("menuitem", { name: "Add to new group" }).click();
  const pill = page.locator(".flexlayout__group_pill");
  await expect(pill).toHaveCount(1);
  await pill.click({ button: "right" });
  await page.getByRole("textbox", { name: "Rename group" }).fill("Research");
  await page.getByRole("textbox", { name: "Rename group" }).press("Enter");
  await expect(pill).toHaveAttribute("aria-label", "Research");
  await pill.click({ button: "right" });
  await page.getByRole("button", { name: "Group color 4", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(nodes(await layout(page)).find((node) => node.type === "tabgroup")).toMatchObject({
    name: "Research",
    color: "#94b870",
  });
  await (await menu(page, "B")).getByRole("button", { name: "Research", exact: true }).click();
  await (await menu(page, "B")).getByRole("menuitem", { name: "Remove from group" }).click();
  expect(nodes(await layout(page)).find((node) => node.type === "tabgroup")?.children).toHaveLength(
    1,
  );
  await (await menu(page, "B")).getByRole("button", { name: "Research", exact: true }).click();
  expect(nodes(await layout(page)).find((node) => node.type === "tabgroup")?.children).toHaveLength(
    2,
  );
  await pill.click();
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Draft C")).toBeVisible();
  await expect(page.locator(`#flexlayout-tabbutton-${await documentId(page, "A")}`)).toBeHidden();
  await pill.click();
  await activate(page, "A");
  await expect(page.getByLabel("Draft A")).toHaveValue("A remains mounted");
  await activate(page, "B");
  await expect(page.getByLabel("Draft B")).toHaveValue("B remains mounted");
  await pill.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ungroup", exact: true }).click();
  await expect(pill).toHaveCount(0);
  const after = await page.evaluate(() => window.worksplitDemo.metrics);
  expect(after).toMatchObject({
    requests: before.requests,
    mounts: before.mounts,
    subscriptions: before.subscriptions,
    unmounts: before.unmounts,
  });
});

test("moving a native group through TabSet and Border retains DOM, input, scroll and resources", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").fill("grouped draft");
  await page.getByTestId("scroll-A").evaluate((element) => {
    element.scrollTop = 420;
  });
  await page.evaluate(() => {
    window.retainedDraft = document.querySelector('[aria-label="Draft A"]');
  });
  const b = await open(page, "B", "right");
  const groupId = await group(page, "A", "Moved");
  await page.evaluate(
    ({ b: contentId, groupId: destinationId }) => {
      const { workbench, Actions, DockLocation } = window.worksplitDemo;
      return workbench.dispatch(
        Actions.moveNode(contentId, destinationId, DockLocation.CENTER, -1),
      );
    },
    { b, groupId },
  );
  await activate(page, "A");
  const before = await page.evaluate(() => ({ ...window.worksplitDemo.metrics }));
  async function moveTo(target: string) {
    expect(
      await page.evaluate(
        ({ groupId: sourceId, target: destinationId }) => {
          const { workbench, Actions, DockLocation } = window.worksplitDemo;
          return workbench.dispatch(
            Actions.moveNode(sourceId, destinationId, DockLocation.CENTER, -1),
          );
        },
        { groupId, target },
      ),
    ).toEqual({ status: "applied" });
    await activate(page, "A");
    await expect(page.getByLabel("Draft A")).toHaveValue("grouped draft");
    if (target === "border_bottom") {
      await page.getByRole("button", { name: "Toggle Inspector", exact: true }).click();
      await expect(page.getByLabel("Draft A")).toBeHidden();
      await activate(page, "A");
    }
  }
  const source = (await page.getByRole("button", { name: "Moved", exact: true }).boundingBox())!;
  const target = (await page.locator(".flexlayout__tabset_tabbar_outer").nth(1).boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 15, source.y + source.height / 2, {
    steps: 5,
  });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      nodes(await layout(page))
        .find((node) => node.id === "right")
        ?.children?.some((node) => node.id === groupId),
    )
    .toBe(true);
  await activate(page, "A");
  await moveTo("border_bottom");
  await moveTo("left");
  expect(await page.getByTestId("scroll-A").evaluate((element) => element.scrollTop)).toBe(420);
  expect(
    await page.evaluate(
      () => window.retainedDraft === document.querySelector('[aria-label="Draft A"]'),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.worksplitDemo.metrics)).toMatchObject({
    requests: before.requests,
    mounts: before.mounts,
    subscriptions: before.subscriptions,
    unmounts: before.unmounts,
  });
});

test("native Close to the Right and Close Others coordinate the whole dirty batch", async ({
  page,
}) => {
  await start(page);
  await open(page, "B");
  await page.getByLabel("Draft B").fill("keep B");
  await open(page, "C");
  await (await menu(page, "A")).getByRole("menuitem", { name: "Close to the Right" }).click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved B");
  expect(await documents(page)).toHaveLength(3);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByTestId("last-result")).toContainText("rejected");
  expect(await documents(page)).toHaveLength(3);
  await activate(page, "B");
  await expect(page.getByLabel("Draft B")).toHaveValue("keep B");
  await (await menu(page, "A")).getByRole("menuitem", { name: "Close Others" }).click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved B");
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect.poll(() => documents(page)).toHaveLength(1);
  await expect(page.getByLabel("Draft A")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.worksplitDemo.metrics.subscriptions)).toBe(1);
  expect(await page.evaluate(() => window.worksplitDemo.metrics)).toMatchObject({
    unmounts: 2,
    disposed: 2,
  });
});

test("native TabSet close visits multiple dirty grouped documents and a rejection closes none", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").fill("dirty A");
  const b = await open(page, "B");
  await page.getByLabel("Draft B").fill("dirty B");
  const groupId = await group(page, "A");
  await page.evaluate(
    ({ b: contentId, groupId: destinationId }) => {
      const { workbench, Actions, DockLocation } = window.worksplitDemo;
      return workbench.dispatch(
        Actions.moveNode(contentId, destinationId, DockLocation.CENTER, -1),
      );
    },
    { b, groupId },
  );
  await page.getByRole("button", { name: "Close tabset", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved A");
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved B");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await documents(page)).toHaveLength(2);
  expect(await page.evaluate(() => window.worksplitDemo.metrics)).toMatchObject({
    subscriptions: 2,
    unmounts: 0,
  });
  await activate(page, "A");
  await expect(page.getByLabel("Draft A")).toHaveValue("dirty A");
  await activate(page, "B");
  await expect(page.getByLabel("Draft B")).toHaveValue("dirty B");
  await page.getByRole("button", { name: "Close tabset", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved A");
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved B");
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect.poll(() => documents(page)).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => window.worksplitDemo.metrics.subscriptions)).toBe(0);
  await expect(page.getByLabel("Inspector note")).toBeVisible();
  expect(nodes(await layout(page)).filter((node) => node.type === "tabgroup")).toHaveLength(0);
  expect(await page.evaluate(() => window.worksplitDemo.metrics)).toMatchObject({
    unmounts: 2,
    disposed: 2,
  });
  await expect(page).toHaveURL(/\/$/);
});

test("native TabSet close preserves a group containing a non-closeable global tool", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").fill("protected group draft");
  const groupId = await group(page, "A", "Mixed group");
  await page.getByLabel("Inspector note").fill("protected tool input");
  await page.evaluate((destinationId) => {
    const { workbench, Actions, DockLocation } = window.worksplitDemo;
    return workbench.dispatch(
      Actions.moveNode("inspector", destinationId, DockLocation.CENTER, -1),
    );
  }, groupId);
  await open(page, "C");
  expect(
    await page.evaluate(() => {
      const { workbench, Actions } = window.worksplitDemo;
      return workbench.dispatch(Actions.deleteTabset("left"));
    }),
  ).toMatchObject({ status: "closed" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await documents(page)).toHaveLength(1);
  expect(nodes(await layout(page)).find((node) => node.id === groupId)?.children).toHaveLength(2);
  await expect(page.getByLabel("Draft A")).toHaveValue("protected group draft");
  await page.evaluate(() => {
    const { workbench, Actions } = window.worksplitDemo;
    return workbench.dispatch(Actions.selectTab("inspector"));
  });
  await expect(page.getByLabel("Inspector note")).toHaveValue("protected tool input");
  await expect(page).toHaveURL(/\/documents\/A/);
  expect(await page.evaluate(() => window.worksplitDemo.metrics.subscriptions)).toBe(1);
});

test("editing or adding a member while TabSet close waits invalidates its approval", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").fill("first revision");
  await page.evaluate(() => {
    const { workbench, Actions } = window.worksplitDemo;
    window.nativeClose = workbench.dispatch(Actions.deleteTabset("left"));
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Draft A").fill("new revision");
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  expect(await page.evaluate(() => window.nativeClose)).toMatchObject({ status: "rejected" });
  await expect(page.getByLabel("Draft A")).toHaveValue("new revision");
  await page.evaluate(() => {
    const { workbench, Actions } = window.worksplitDemo;
    window.nativeClose = workbench.dispatch(Actions.deleteTabset("left"));
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await open(page, "C");
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  expect(await page.evaluate(() => window.nativeClose)).toMatchObject({ status: "rejected" });
  expect(await documents(page)).toHaveLength(2);
  await activate(page, "A");
  await expect(page.getByLabel("Draft A")).toHaveValue("new revision");
  expect(await page.evaluate(() => window.worksplitDemo.metrics.subscriptions)).toBe(2);
});

test("editing an approved member while the next batch decision waits rejects the entire close", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").fill("A first revision");
  await open(page, "B", "right");
  await page.getByLabel("Draft B").fill("B first revision");
  await page.evaluate(() => {
    const { workbench, Actions } = window.worksplitDemo;
    window.nativeClose = workbench.dispatch(
      Actions.group([Actions.deleteTabset("left"), Actions.deleteTabset("right")]),
    );
  });
  await expect(page.getByRole("dialog")).toContainText("Unsaved A");
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved B");
  await page.getByLabel("Draft A").fill("A edited after approval", { force: true });
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  expect(await page.evaluate(() => window.nativeClose)).toMatchObject({
    status: "rejected",
    reason: "changed",
  });
  expect(await documents(page)).toHaveLength(2);
  await activate(page, "A");
  await expect(page.getByLabel("Draft A")).toHaveValue("A edited after approval");
  await activate(page, "B");
  await expect(page.getByLabel("Draft B")).toHaveValue("B first revision");
  expect(await page.evaluate(() => window.worksplitDemo.metrics)).toMatchObject({
    subscriptions: 2,
    unmounts: 0,
    disposed: 0,
  });
});

test("a native route commit while bulk close waits keeps the new content and the other members", async ({
  page,
}) => {
  await start(page);
  await open(page, "B");
  await activate(page, "A");
  await page.getByLabel("Draft A").fill("dirty route");
  await page.evaluate(() => {
    const { workbench, Actions } = window.worksplitDemo;
    window.nativeClose = workbench.dispatch(Actions.deleteTabset("left"));
  });
  await expect(page.locator('[data-decision="close"]')).toBeVisible();
  await page.getByRole("link", { name: "Fast view", exact: true }).click();
  await page
    .locator('[data-decision="navigate"]')
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  await expect(page.getByTestId("document-A")).toContainText("View: fast");
  await page
    .locator('[data-decision="close"]')
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  expect(await page.evaluate(() => window.nativeClose)).toMatchObject({ status: "rejected" });
  expect(await documents(page)).toHaveLength(2);
  await expect(page).toHaveURL(/view=fast/);
});

test("grouping a global tool and changing its native attributes keeps document URL ownership", async ({
  page,
}) => {
  await start(page);
  const accepted = page.url();
  await page.getByLabel("Inspector note").fill("global tool state");
  await page.evaluate(() => {
    const { workbench, Actions, DockLocation } = window.worksplitDemo;
    return workbench.dispatch(Actions.moveNode("inspector", "left", DockLocation.CENTER, -1));
  });
  expect(
    await page.evaluate(() => {
      const { workbench, Actions } = window.worksplitDemo;
      return workbench.dispatch(Actions.addTabToNewGroup("inspector", "Tools", "#7895c4"));
    }),
  ).toEqual({ status: "applied" });
  await page.getByLabel("Inspector note").click();
  await expect(page).toHaveURL(accepted);
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext()),
  ).toMatchObject({ focusedArea: "tool", focusedTabId: "inspector" });
  const pill = page.getByRole("button", { name: "Tools", exact: true });
  await pill.click({ button: "right" });
  await page.getByRole("textbox", { name: "Rename group" }).fill("Workspace tools");
  await page.getByRole("textbox", { name: "Rename group" }).press("Enter");
  await expect(page).toHaveURL(accepted);
  await expect(page.getByLabel("Inspector note")).toHaveValue("global tool state");
});

test("group snapshots restore native names, colors and collapsed state without unsupported windows", async ({
  page,
}) => {
  await start(page);
  const groupId = await group(page, "A", "Restored group");
  await open(page, "B", "right");
  await page.evaluate((nodeId) => {
    const { workbench, Actions } = window.worksplitDemo;
    return workbench.dispatch(Actions.updateNodeAttributes(nodeId, { opened: false }));
  }, groupId);
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await page.getByLabel("Restore on refresh").check();
  await page.reload();
  await expect(page.getByLabel("Draft B")).toBeVisible();
  const restored = nodes(await layout(page)).find((node) => node.id === groupId);
  expect(restored).toMatchObject({
    type: "tabgroup",
    name: "Restored group",
    color: "#94b870",
    opened: false,
  });
  await page.getByRole("button", { name: "Restored group", exact: true }).click();
  await activate(page, "A");
  await expect(page.getByLabel("Draft A")).toBeVisible();
  const menuA = await menu(page, "A");
  await expect(menuA.getByRole("menuitem", { name: /Float|Popout/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const a = await documentId(page, "A");
  expect(
    await page.evaluate((contentId) => {
      const { workbench, Actions } = window.worksplitDemo;
      return workbench.dispatch(Actions.popoutTab(contentId, "float"));
    }, a),
  ).toEqual({ status: "rejected" });
});

test("narrow switching resolves grouped tabs to their native TabSets and preserves desktop layout", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").fill("narrow retained A");
  const a = await documentId(page, "A");
  await group(page, "A", "Left group");
  const b = await open(page, "B", "right");
  await page.getByLabel("Draft B").fill("narrow retained B");
  await group(page, "B", "Right group");
  const before = await page.evaluate(() => ({ ...window.worksplitDemo.metrics }));
  await expect(page.getByTestId("metrics")).toContainText('"subscriptions": 2');
  await page.screenshot({ path: "refactor/acceptance/native-groups-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const switcher = page.getByRole("combobox", { name: "Open document" });
  await expect(switcher).toBeVisible();
  await switcher.selectOption(a);
  await expect(page.getByLabel("Draft A")).toHaveValue("narrow retained A");
  await page.getByLabel("Draft A").click();
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext()),
  ).toMatchObject({ activeGroupId: "left", focusedArea: "document", focusedTabId: a });
  await switcher.selectOption(b);
  await expect(page.getByLabel("Draft B")).toHaveValue("narrow retained B");
  await page.getByLabel("Draft B").click();
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext()),
  ).toMatchObject({ activeGroupId: "right", focusedArea: "document", focusedTabId: b });
  await page.screenshot({ path: "refactor/acceptance/native-groups-narrow.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByLabel("Draft A")).toHaveValue("narrow retained A");
  await expect(page.getByLabel("Draft B")).toHaveValue("narrow retained B");
  expect(await page.evaluate(() => window.worksplitDemo.metrics)).toMatchObject({
    requests: before.requests,
    mounts: before.mounts,
    subscriptions: before.subscriptions,
    unmounts: before.unmounts,
  });
});

test("narrow moving the same active group into a native split reveals its new TabSet", async ({
  page,
}) => {
  await start(page);
  await open(page, "B", "right");
  const activeId = await activate(page, "A");
  await page.getByLabel("Draft A").fill("active group remains visible");
  const groupId = await group(page, "A", "Active group");
  await page.evaluate(() => {
    window.retainedDraft = document.querySelector('[aria-label="Draft A"]');
  });
  const before = await page.evaluate(() => ({ ...window.worksplitDemo.metrics }));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Draft A")).toBeVisible();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.getByTestId("scroll-A").evaluate((element) => {
    element.scrollTop = 360;
  });
  expect(
    await page.evaluate((sourceId) => {
      const { workbench, Actions, DockLocation } = window.worksplitDemo;
      return workbench.dispatch(Actions.moveNode(sourceId, "right", DockLocation.RIGHT, -1));
    }, groupId),
  ).toEqual({ status: "applied" });
  await expect(page.getByLabel("Draft A")).toBeVisible();
  await expect(page.getByLabel("Draft A")).toHaveValue("active group remains visible");
  await expect
    .poll(() =>
      page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().activeGroupId),
    )
    .not.toBe("left");
  const activeContainer = await page.evaluate(
    () => window.worksplitDemo.workbench.getEditingContext().activeGroupId,
  );
  expect(nodes(await layout(page)).find((node) => node.id === activeContainer)).toMatchObject({
    type: "tabset",
    maximized: true,
  });
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().activeTabId),
  ).toBe(activeId);
  expect(await page.getByTestId("scroll-A").evaluate((element) => element.scrollTop)).toBe(360);
  expect(
    await page.evaluate(
      () => window.retainedDraft === document.querySelector('[aria-label="Draft A"]'),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.worksplitDemo.metrics)).toMatchObject({
    requests: before.requests,
    mounts: before.mounts,
    subscriptions: before.subscriptions,
    unmounts: before.unmounts,
  });
});
