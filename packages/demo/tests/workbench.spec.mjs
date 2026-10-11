import { expect, test } from "@playwright/test";

async function start(page) {
  await page.goto("/documents/A?view=edit&delay=0");
  await expect(page.getByLabel("Draft A")).toBeVisible();
}
async function openB(page) {
  await page.getByRole("button", { name: "B Document B", exact: true }).click();
  await expect(page.getByLabel("Draft B")).toBeVisible();
}
async function ids(page) {
  return page.evaluate(() => window.worksplitDemo.workbench.getDocuments());
}
async function tabsetId(page, contentId) {
  return page.evaluate((id) => {
    const contains = (node) =>
      node.id === id || (node.children ?? []).some((child) => contains(child));
    const find = (node) =>
      node.type === "tabset" && contains(node)
        ? node.id
        : (node.children ?? []).map(find).find(Boolean);
    return find(window.worksplitDemo.workbench.getLayout().layout);
  }, contentId);
}

test("two native route contexts, nested Outlet, typed navigation and tool focus", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await expect(page.getByTestId("navigation-owner")).toHaveText("documents");
  await page.getByLabel("Draft A").fill("A only");
  await expect(page).toHaveURL(/\/documents\/A/);
  await page.getByLabel("Inspector note").fill("global");
  await expect(page).toHaveURL(/\/documents\/A/);
  await page.getByTestId("document-B").getByRole("link", { name: "Details", exact: true }).click();
  await expect(page.getByTestId("nested-route")).toContainText("B");
  await expect(page.getByLabel("Draft A")).toHaveValue("A only");
});

test("dirty rejection, target search navigation and redirect deduplication preserve source", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByLabel("Draft A").fill("unsaved A");
  await page.getByRole("button", { name: "↪ Redirect to B", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/B/);
  await expect(page.getByLabel("Draft A")).toHaveValue("unsaved A");
  expect(await ids(page)).toHaveLength(2);
  await page.getByTestId("document-A").getByRole("link", { name: "Change view" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).first().click();
  await expect(page.getByTestId("document-A")).toContainText("View: edit");
  await expect(page).toHaveURL(/\/documents\/A.*view=edit/);
});

test("native Router blocker rejection settles Worksplit's receipt", async ({ page }) => {
  await start(page);
  await page.getByLabel("Native Router blocker").check();
  const result = await page.evaluate(() =>
    window.worksplitDemo.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "preview", delay: 0 },
    }),
  );
  expect(result).toEqual({ status: "rejected", reason: "router-blocked" });
  await expect(page).toHaveURL(/view=edit/);
  await expect(page.getByTestId("document-A")).toContainText("View: edit");
});

test("continuous browser back rejection restores the accepted entry and forward stack", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() =>
    window.worksplitDemo.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "preview", delay: 0 },
    }),
  );
  await expect(page).toHaveURL(/view=preview/);
  await page.evaluate(() =>
    window.worksplitDemo.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "review", delay: 0 },
    }),
  );
  await expect(page).toHaveURL(/view=review/);
  const accepted = page.url();
  const length = await page.evaluate(() => history.length);
  await page.getByLabel("Draft A").fill("dirty history");
  await page.evaluate(() => history.back());
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.worksplitDemo.workbench.open({
        to: "/documents/$id",
        params: { id: "B" },
        search: { view: "edit", delay: 0 },
      }),
    ),
  ).toEqual({ status: "rejected", reason: "history-busy" });
  await page.evaluate(() => history.back());
  await expect.poll(() => page.evaluate(() => window.worksplitDemo.decisions.get().length)).toBe(2);
  await page.getByRole("button", { name: "Keep editing" }).first().click();
  await page.getByRole("button", { name: "Keep editing" }).first().click();
  await expect(page).toHaveURL(accepted);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("last-result")).toContainText("Saved A");
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/view=preview/);
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(accepted);
});

test("slow navigation loses foreground eligibility after another document is focused", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByLabel("Draft A").click();
  await page.evaluate(() => {
    window.pendingNavigation = window.worksplitDemo.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "slow", delay: 700 },
    });
  });
  await page.getByLabel("Draft B").click();
  await expect(page).toHaveURL(/\/documents\/B/);
  await expect(page.getByTestId("document-A")).toContainText("View: slow");
  await expect(page).toHaveURL(/\/documents\/B/);
});

test("native movement, pin, maximize and Border hiding retain input, scroll and resources", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByLabel("Draft A").fill("retained");
  await page.getByTestId("scroll-A").evaluate((element) => {
    element.scrollTop = 480;
  });
  const before = await page.evaluate(() => ({ ...window.worksplitDemo.metrics }));
  await page.getByRole("button", { name: "Focus group", exact: true }).click();
  await expect(page.getByLabel("Draft B")).toBeHidden();
  await page.getByRole("button", { name: "Focus group", exact: true }).click();
  await expect(page.getByLabel("Draft B")).toBeVisible();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Split right", exact: true }).click();
  await expect(page.getByLabel("Draft A")).toHaveValue("retained");
  await page.getByRole("button", { name: "Move to Border" }).click();
  await expect(page.getByLabel("Draft A")).toHaveValue("retained");
  await page.getByRole("button", { name: "Toggle Inspector" }).click();
  await page.getByRole("button", { name: "Toggle Inspector" }).click();
  await page.evaluate(() =>
    window.worksplitDemo.workbench.activate(
      window.worksplitDemo.workbench.getDocuments().find((d) => d.href.includes("/documents/A")).id,
    ),
  );
  await page.getByRole("button", { name: "Move to center" }).click();
  await expect(page.getByLabel("Draft A")).toHaveValue("retained");
  expect(await page.getByTestId("scroll-A").evaluate((element) => element.scrollTop)).toBe(480);
  const after = await page.evaluate(() => window.worksplitDemo.metrics);
  expect(after.requests).toBe(before.requests);
  expect(after.mounts).toBe(before.mounts);
  expect(after.subscriptions).toBe(before.subscriptions);
});

test("editing during close invalidates approval; repeated closes share a decision", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").fill("first revision");
  await page.getByRole("button", { name: "Close document" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close document" }).click();
  expect(await page.evaluate(() => window.worksplitDemo.decisions.get().length)).toBe(1);
  await page.getByLabel("Draft A").fill("later revision");
  await page.getByRole("button", { name: "Discard and continue" }).click();
  await expect(page.getByLabel("Draft A")).toHaveValue("later revision");
  await expect(page.getByTestId("last-result")).toContainText("rejected");
  await page.getByRole("button", { name: "Close document" }).click();
  await page.getByRole("button", { name: "Discard and continue" }).click();
  await expect(page.getByLabel("Draft A")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.worksplitDemo.metrics.subscriptions)).toBe(0);
});

test("late loader after close cannot resurrect its document or URL", async ({ page }) => {
  await start(page);
  await page.getByRole("link", { name: "Change view" }).click();
  await expect(page).toHaveURL(/view=preview/);
  await page.evaluate(() => {
    const { workbench } = window.worksplitDemo;
    const document = workbench.getActiveDocument();
    window.pendingNavigation = workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit", delay: 1200 },
    });
    window.closingId = document.id;
  });
  // The speculative open does not replace A until its load is ready.
  await page.evaluate(() => window.worksplitDemo.workbench.close(window.closingId));
  await expect(page.getByLabel("Draft A")).toHaveCount(0);
  await page.waitForTimeout(1400);
  expect(await ids(page)).toHaveLength(0);
  await expect(page).toHaveURL(/\/$/);
});

test("new route content invalidates an older close approval", async ({ page }) => {
  await start(page);
  await page.getByLabel("Draft A").fill("dirty");
  await page.getByRole("button", { name: "Close document" }).click();
  await page.getByRole("link", { name: "Fast view", exact: true }).click();
  await expect(page.locator('[data-decision="navigate"]')).toBeVisible();
  await page
    .locator('[data-decision="navigate"]')
    .getByRole("button", { name: "Discard and continue" })
    .click();
  await expect(page.getByTestId("document-A")).toContainText("View: fast");
  await page
    .locator('[data-decision="close"]')
    .getByRole("button", { name: "Discard and continue" })
    .click();
  await expect(page.getByLabel("Draft A")).toBeVisible();
  await expect(page.getByTestId("last-result")).toContainText("rejected");
});

test("native same-document slow navigation is superseded by its later fast navigation", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("link", { name: "Slow view", exact: true }).click();
  await page.getByRole("link", { name: "Fast view", exact: true }).click();
  await expect(page).toHaveURL(/view=fast/);
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("document-A")).toContainText("View: fast");
  await expect(page).toHaveURL(/view=fast/);
});

test("native redirect conflict is visible and never merges or closes another instance", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByTestId("document-A").getByRole("link", { name: "Native redirect to B" }).click();
  await expect.poll(() => ids(page)).toHaveLength(2);
  await expect(page.getByTestId("last-result")).toContainText("native-identity-conflict");
  expect(await ids(page)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ href: expect.stringContaining("/documents/B") }),
    ]),
  );
  await expect(page.getByLabel("Draft B")).toHaveCount(2);
});

test("loader and renderer failures are isolated to their routed instances", async ({ page }) => {
  await start(page);
  await openB(page);
  await page.getByRole("button", { name: "! Loader error", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("loader failure");
  await expect(page.getByLabel("Draft A")).toBeVisible();
  await page.getByRole("button", { name: "× Renderer error", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "renderer failure" })).toBeVisible();
  await expect(page.getByTestId("navigation-owner")).toHaveText("errors");
  await expect(page.getByLabel("Draft A")).toBeVisible();
});

test("snapshot refresh uses the deep link, validates unknown data and offers explicit reset", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await page.getByLabel("Restore on refresh").check();
  await page.goto("/documents/A?view=edit&delay=0");
  await expect(page.getByLabel("Draft A")).toBeVisible();
  await expect(page).toHaveURL(/\/documents\/A/);
  expect(await ids(page)).toHaveLength(2);
  await page.evaluate(() =>
    localStorage.setItem("worksplit.demo.layout", JSON.stringify({ version: 999 })),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Incompatible");
  await page.getByRole("button", { name: "Reset saved layout" }).click();
  await expect(page.getByLabel("Draft A")).toBeVisible();
});

test("narrow document switching retains content and desktop layout preferences", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByLabel("Draft A").fill("desktop draft");
  await page.getByRole("button", { name: "Focus group", exact: true }).click();
  await expect(page.getByLabel("Draft B")).toBeHidden();
  const before = await page.evaluate(() => ({
    snapshot: window.worksplitDemo.workbench.snapshot(),
    metrics: { ...window.worksplitDemo.metrics },
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("combobox", { name: "Open document" })).toBeVisible();
  const documents = await ids(page);
  await page
    .getByRole("combobox", { name: "Open document" })
    .selectOption(documents.find((d) => d.href.includes("/documents/B")).id);
  await expect(page.getByLabel("Draft B")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Open document" })
    .selectOption(documents.find((d) => d.href.includes("/documents/A")).id);
  await expect(page.getByLabel("Draft A")).toHaveValue("desktop draft");
  await page
    .getByTestId("document-A")
    .getByRole("link", { name: "Fast view", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByTestId("document-A").getByRole("link", { name: "Fast view", exact: true }),
  ).toBeInViewport();
  await page.getByTestId("document-A").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: "refactor/acceptance/narrow.png" });
  expect(
    await page.evaluate(() =>
      window.worksplitDemo.workbench.snapshot().layout.layout.children.some((n) => n.maximized),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("combobox", { name: "Open document" })).toHaveCount(0);
  await expect(page.getByLabel("Draft B")).toBeHidden();
  await page.getByRole("button", { name: "Focus group", exact: true }).click();
  await expect(page.getByLabel("Draft B")).toBeVisible();
  const after = await page.evaluate(() => window.worksplitDemo.metrics);
  expect(after.mounts).toBe(before.metrics.mounts);
  expect(after.requests).toBe(before.metrics.requests);
  await page.screenshot({ path: "refactor/acceptance/desktop.png" });
});

test("commands save one captured active document; tool input keeps the document URL", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByLabel("Draft A").fill("save me");
  await page.getByLabel("Inspector note").fill("tool focused");
  const before = page.url();
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("last-result")).toContainText("Saved A");
  await expect(page).toHaveURL(before);
  await page.getByTestId("document-A").getByRole("link", { name: "Change view" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/view=preview/);
});

test("native drag moves the existing content, and a portal command retains its tool context", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByLabel("Draft A").fill("drag keeps this");
  const docs = await ids(page);
  const a = docs.find((d) => d.href.includes("/documents/A"));
  const b = docs.find((d) => d.href.includes("/documents/B"));
  const destination = await tabsetId(page, b.id);
  const source = await page.locator(`#flexlayout-tabbutton-${a.id}`).boundingBox();
  const target = await page.locator(`#flexlayout-tabbutton-${b.id}`).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 15, source.y + source.height / 2, {
    steps: 5,
  });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().activeGroupId),
    )
    .toBe(destination);
  await expect(page.getByLabel("Draft A")).toHaveValue("drag keeps this");
  await page.getByRole("button", { name: "Tool menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Run tool command" }).click();
  await expect(page.getByTestId("last-result")).toContainText("Tool command: inspector");
  await expect(page).toHaveURL(/\/documents\/A/);
});

test("window focus is observed independently, and closing the last document keeps an empty workspace", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Draft A").click();
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().windowFocused),
  ).toBe(false);
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().activeTabId),
  ).toBeTruthy();
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().windowFocused),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().focusedArea),
  ).toBe("document");
  await page.getByLabel("Draft A").click();
  expect(
    await page.evaluate(() => {
      const { workbench } = window.worksplitDemo;
      return workbench.close(workbench.getActiveDocument().id);
    }),
  ).toMatchObject({ status: "closed" });
  await expect(page.getByLabel("Draft A")).toHaveCount(0);
  await expect(page.getByText("Open a routed document from the navigation.").first()).toBeVisible();
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().activeTabId),
  ).toBeNull();
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext()),
  ).toMatchObject({
    focusedTabId: null,
    focusedArea: null,
  });
  await expect(page.getByLabel("Inspector note")).toBeVisible();
});

test("a later Worksplit open supersedes a slow same-document open without a late URL commit", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    window.slowOpen = window.worksplitDemo.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "slow", delay: 800 },
    });
  });
  const fast = await page.evaluate(() =>
    window.worksplitDemo.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "fast", delay: 0 },
    }),
  );
  expect(fast.status).toBe("committed");
  expect(await page.evaluate(() => window.slowOpen)).toMatchObject({ status: "superseded" });
  await expect(page.getByTestId("document-A")).toContainText("View: fast");
  await expect(page).toHaveURL(/view=fast/);
  expect(await ids(page)).toHaveLength(1);
});

test("tool focus revokes a pending document open's foreground eligibility", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    window.toolInterruptedOpen = window.worksplitDemo.workbench.open({
      to: "/documents/$id",
      params: { id: "slow" },
      search: { view: "edit", delay: 750 },
    });
  });
  await page.getByLabel("Inspector note").fill("stay in this tool");
  expect(await page.evaluate(() => window.toolInterruptedOpen)).toMatchObject({
    status: "committed",
  });
  await expect(page).toHaveURL(/\/documents\/A/);
  await expect(page.getByLabel("Inspector note")).toBeFocused();
  await expect(page.getByLabel("Inspector note")).toHaveValue("stay in this tool");
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext()),
  ).toMatchObject({ focusedArea: "tool", focusedTabId: "inspector" });
});

test("document focus chooses the native default group; a centrally docked tool preserves the URL", async ({
  page,
}) => {
  await start(page);
  await openB(page);
  await page.getByLabel("Draft A").click();
  const currentDocuments = await ids(page);
  const aContainer = await tabsetId(
    page,
    currentDocuments.find((doc) => doc.href.includes("/documents/A")).id,
  );
  const bContainer = await tabsetId(
    page,
    currentDocuments.find((doc) => doc.href.includes("/documents/B")).id,
  );
  const opened = await page.evaluate(() =>
    window.worksplitDemo.workbench.open({
      to: "/documents/$id",
      params: { id: "C" },
      search: { view: "edit", delay: 0 },
    }),
  );
  expect(opened.status).toBe("committed");
  await expect(page.getByLabel("Draft C")).toBeVisible();
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext().activeGroupId),
  ).toBe(aContainer);
  await page.getByLabel("Inspector note").fill("tool state");
  const accepted = page.url();
  expect(
    await page.evaluate((destinationId) => {
      const { workbench, Actions, DockLocation } = window.worksplitDemo;
      return workbench.dispatch(
        Actions.moveNode("inspector", destinationId, DockLocation.CENTER, -1),
      );
    }, bContainer),
  ).toEqual({ status: "applied" });
  await expect(page.getByLabel("Inspector note")).toHaveValue("tool state");
  await page.getByLabel("Inspector note").click();
  await expect(page).toHaveURL(accepted);
  expect(
    await page.evaluate(() => window.worksplitDemo.workbench.getEditingContext()),
  ).toMatchObject({
    activeTabId: opened.document.id,
    focusedTabId: "inspector",
    focusedArea: "tool",
  });
});

test("reload and close never recycle a history hint into a different document; disposal releases owned routers", async ({
  page,
}) => {
  await start(page);
  const oldId = (await ids(page))[0].id;
  await page.getByRole("link", { name: "Change view", exact: true }).click();
  await expect(page).toHaveURL(/view=preview/);
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await page.getByLabel("Restore on refresh").check();
  await page.reload();
  await expect(page.getByLabel("Draft A")).toBeVisible();
  await page.getByRole("button", { name: "Close document" }).click();
  await openB(page);
  const b = (await ids(page)).find((doc) => doc.href.includes("/documents/B"));
  expect(b.id).not.toBe(oldId);
  await page.evaluate(() => history.go(-2));
  await expect(page.getByLabel("Draft A")).toBeVisible();
  expect(await ids(page)).toHaveLength(2);
  await expect(page.getByLabel("Draft B")).toHaveValue("");
  expect((await ids(page)).find((doc) => doc.href.includes("/documents/A")).id).not.toBe(oldId);
  expect(await page.evaluate(() => window.worksplitDemo.workbench.dispose())).toEqual([]);
  await expect
    .poll(() => page.evaluate(() => window.worksplitDemo.getMetrics().subscriptions))
    .toBe(0);
  expect(await page.evaluate(() => window.worksplitDemo.getMetrics())).toMatchObject({
    liveRouters: 0,
    historySubscriptions: 0,
  });
});
