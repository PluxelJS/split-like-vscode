/* oxlint-disable no-shadow -- Playwright evaluate callbacks run in a separate JavaScript realm. */
import assert from "node:assert/strict";

async function assertRetained(handle, id) {
  assert.equal(
    await handle.evaluate(
      (node, id) => node === document.querySelector(`[data-worksplit-content="${id}"] textarea`),
      id,
    ),
    true,
  );
}

/** The same real-browser protections run against the demo and independently installed tarballs. */
export async function checkWorkBenchBrowser(page, { viewport, report }) {
  const record = (text) => report.checks.push(`${viewport.width}×${viewport.height}: ${text}`);
  async function reset() {
    await page.evaluate(async () => {
      await window.worksplitPublic.lifecycle?.dispose();
      await window.worksplitPublic.browser?.dispose();
      for (const key of Object.keys(localStorage))
        if (key.startsWith("worksplit-example:editor:")) localStorage.removeItem(key);
      history.replaceState({ __TSR_index: 0 }, "", "/");
    });
    await page.reload();
    await page.getByRole("button", { name: "Lifecycles", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.worksplitPublic.lifecycle?.instance.getContext() &&
        document.querySelector('[aria-label="Lifecycle example"]'),
    );
  }
  async function open(name) {
    return page.evaluate(async (name) => {
      const result = await window.worksplitPublic.lifecycle.instance.open({
        to: "/lab/$name",
        params: { name },
      });
      if (result.status !== "applied") throw new Error(JSON.stringify(result));
      return result.value.document.id;
    }, name);
  }
  const input = (id) => page.locator(`[data-worksplit-content="${id}"] textarea`);
  async function activate(id) {
    await page.evaluate((id) => window.worksplitPublic.lifecycle.instance.activate(id), id);
    await input(id).waitFor({ state: "visible" });
  }
  async function waitGate(key) {
    await page.waitForFunction(
      (key) => window.worksplitPublic.lifecycle.loads.some((load) => load.key === key),
      key,
    );
  }
  const release = (key) =>
    page.evaluate((key) => window.worksplitPublic.lifecycle.release(key), key);
  const decision = (name) => page.getByRole("button", { name, exact: true });

  await reset();
  let a = await open("A");
  let b = await open("B");
  await page.evaluate(
    async ({ a, b }) => {
      const {
        lifecycle: { instance },
        native: { Actions, DockLocation },
      } = window.worksplitPublic;
      const result = await instance.dispatch(
        Actions.moveNode(b, instance.getDocument(a).containerId, DockLocation.RIGHT, -1),
      );
      if (result.status !== "applied") throw new Error(JSON.stringify(result));
    },
    { a, b },
  );
  await input(a).fill("Draft retained in A");
  const editorA = await input(a).elementHandle();
  const editorB = await input(b).elementHandle();
  const beforeSlow = page.url();
  await page.evaluate((a) => {
    const session = window.worksplitPublic.lifecycle;
    window.lifecycleCheck = {};
    void session.instance
      .open(
        { to: "/lab/$name", params: { name: "C" }, search: { delay: "foreground" } },
        { source: session.instance.getDocument(a).handle },
      )
      .then((result) => {
        window.lifecycleCheck.result = result;
        return;
      });
  }, a);
  await waitGate("foreground");
  await page.getByRole("textbox", { name: "Lifecycle tool", exact: true }).fill("Tool focus wins");
  await release("foreground");
  await page.waitForFunction(() => window.lifecycleCheck.result);
  assert.deepEqual(
    await page.evaluate(() => ({
      status: window.lifecycleCheck.result.status,
      presentation: window.lifecycleCheck.result.value?.presentation,
    })),
    { status: "applied", presentation: "background" },
  );
  assert.equal(page.url(), beforeSlow);
  assert.equal(await input(a).inputValue(), "Draft retained in A");
  await assertRetained(editorA, a);
  await assertRetained(editorB, b);
  record(
    "slow open loses foreground eligibility to actual tool focus; source/sibling DOM, draft and URL survive",
  );

  await reset();
  a = await open("A");
  await page.waitForFunction(
    (id) =>
      document.activeElement ===
      document.querySelector(`[data-worksplit-content="${id}"] textarea`),
    a,
  );
  b = await open("B");
  await page.evaluate(
    async ({ a, b }) => {
      const {
        lifecycle: { instance },
        native: { Actions, DockLocation },
      } = window.worksplitPublic;
      await instance.dispatch(
        Actions.moveNode(b, instance.getDocument(a).containerId, DockLocation.RIGHT, -1),
      );
      await instance.dispatch(Actions.maximizeToggle(instance.getDocument(a).containerId));
    },
    { a, b },
  );
  await input(b).waitFor({ state: "hidden" });
  await activate(b);
  await page.waitForFunction(
    (id) =>
      document.activeElement ===
      document.querySelector(`[data-worksplit-content="${id}"] textarea`),
    b,
  );
  await page.evaluate(async () => {
    const {
      lifecycle: { instance },
      native: { Actions },
    } = window.worksplitPublic;
    const maximized = instance.model.getMaximizedTabset();
    if (maximized) await instance.dispatch(Actions.maximizeToggle(maximized.getId()));
  });
  await activate(a);
  await input(a).fill("Native move keeps this draft");
  const nativeEditor = await input(a).elementHandle();
  const scrollRoot = page.locator(`[data-worksplit-content="${a}"] .lifecycle-document`);
  await scrollRoot.evaluate((node) => {
    node.scrollTop = 330;
  });
  const scrolled = await scrollRoot.evaluate((node) => node.scrollTop);
  assert.ok(scrolled > 0);
  const group = await page.evaluate(async (id) => {
    const {
      lifecycle: { instance },
      native: { Actions, DockLocation },
    } = window.worksplitPublic;
    await instance.dispatch(Actions.addTabToNewGroup(id, "Move lifetime", "#7950a0"));
    const groupNode = instance.model.getNodeById(id).getParent();
    const border = instance.getContent("lifecycle-tool").node.getParent();
    const target = groupNode.getParent().getId();
    const result = await instance.dispatch(
      Actions.moveNode(groupNode.getId(), border.getId(), DockLocation.CENTER, -1),
    );
    if (result.status !== "applied") throw new Error(JSON.stringify(result));
    return { id: groupNode.getId(), target };
  }, a);
  await activate(a);
  await assertRetained(nativeEditor, a);
  assert.equal(await input(a).inputValue(), "Native move keeps this draft");
  assert.equal(await scrollRoot.evaluate((node) => node.scrollTop), scrolled);
  const nativeUrl = page.url();
  await page.getByRole("tab", { name: "Lifecycle tool", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Lifecycle tool", exact: true })
    .fill("Tool border state");
  assert.equal(page.url(), nativeUrl);
  await activate(a);
  await page.evaluate(async ({ id, target }) => {
    const {
      lifecycle: { instance },
      native: { Actions, DockLocation },
    } = window.worksplitPublic;
    const fallback = instance.getContainers().find((container) => container.kind === "tabset")?.id;
    const destination = instance.model.getNodeById(target) ? target : fallback;
    if (!destination) throw new Error("No actual native TabSet for return");
    const result = await instance.dispatch(
      Actions.moveNode(id, destination, DockLocation.CENTER, -1),
    );
    if (result.status !== "applied") throw new Error(JSON.stringify(result));
  }, group);
  await activate(a);
  await assertRetained(nativeEditor, a);
  assert.equal(await scrollRoot.evaluate((node) => node.scrollTop), scrolled);
  assert.equal(
    await page.evaluate((id) => window.worksplitPublic.lifecycle.releasedResources.includes(id), a),
    false,
  );
  record(
    "first-open focus waits for content; explicit activation reveals a maximized sibling; native group Border round-trip preserves editor DOM, scroll, draft and resources while tool focus leaves the URL unchanged",
  );

  await reset();
  a = await open("A");
  await input(a).fill("Protected mixed group draft");
  await page
    .getByRole("textbox", { name: "Lifecycle tool", exact: true })
    .fill("Protected tool draft");
  await page.evaluate(async (id) => {
    const {
      lifecycle: { instance },
      native: { Actions, DockLocation },
    } = window.worksplitPublic;
    await instance.dispatch(Actions.addTabToNewGroup(id, "Protected mixed group", "#426b42"));
    const group = instance.model.getNodeById(id).getParent();
    await instance.dispatch(Actions.updateNodeAttributes("lifecycle-tool", { enableClose: false }));
    await instance.dispatch(
      Actions.moveNode("lifecycle-tool", group.getId(), DockLocation.CENTER, -1),
    );
  }, a);
  b = await open("B");
  const protectedClose = await page.evaluate(async (id) => {
    const {
      lifecycle: { instance },
      native: { Actions },
    } = window.worksplitPublic;
    return instance.dispatch(Actions.deleteTabset(instance.getDocument(id).containerId));
  }, a);
  assert.equal(protectedClose.status, "applied");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(
    await page.evaluate(() =>
      window.worksplitPublic.lifecycle.instance.getDocuments().map((doc) => doc.id),
    ),
    [a],
  );
  await activate(a);
  assert.equal(await input(a).inputValue(), "Protected mixed group draft");
  await page.evaluate(() => {
    const {
      lifecycle: { instance },
      native: { Actions },
    } = window.worksplitPublic;
    return instance.dispatch(Actions.selectTab("lifecycle-tool"));
  });
  assert.equal(
    await page.getByRole("textbox", { name: "Lifecycle tool", exact: true }).inputValue(),
    "Protected tool draft",
  );
  record(
    "native TabSet close preserves a mixed group containing a non-closeable tool and its dirty editor while closing eligible siblings",
  );

  await reset();
  a = await open("A");
  await input(a).fill("Membership close basis");
  await page.evaluate((id) => {
    const {
      lifecycle: { instance },
      native: { Actions },
    } = window.worksplitPublic;
    window.lifecycleCheck = {};
    void instance
      .dispatch(Actions.deleteTabset(instance.getDocument(id).containerId))
      .then((result) => {
        window.lifecycleCheck.result = result;
        return;
      });
  }, a);
  await page.getByRole("dialog", { name: "Leave A?", exact: true }).waitFor();
  b = await page.evaluate(async () => {
    const result = await window.worksplitPublic.lifecycle.instance.open(
      { to: "/lab/$name", params: { name: "B" } },
      { presentation: "background" },
    );
    if (result.status !== "applied") throw new Error(JSON.stringify(result));
    return result.value.document.id;
  });
  await decision("Leave without saving").click();
  await page.waitForFunction(() => window.lifecycleCheck.result);
  assert.equal(await page.evaluate(() => window.lifecycleCheck.result.status), "denied");
  assert.equal(
    await page.evaluate(() => window.worksplitPublic.lifecycle.instance.getDocuments().length),
    2,
  );
  await activate(a);
  assert.equal(await input(a).inputValue(), "Membership close basis");
  record(
    "adding an actual native TabSet member while close approval waits invalidates the batch before any content or resource is removed",
  );

  await reset();
  a = await open("A");
  await page.evaluate((id) => {
    const router = window.worksplitPublic.lifecycle.routers.get(id);
    window.lifecycleCheck = { outcomes: [] };
    void router
      .navigate({
        to: "/lab/$name",
        params: { name: "A" },
        search: { delay: "superseded" },
        onNavigationResult: (result) => window.lifecycleCheck.outcomes.push(result.status),
      })
      .then(() => {
        window.lifecycleCheck.slowSettled = true;
        return;
      });
  }, a);
  await waitGate("superseded");
  await page.evaluate(
    (id) =>
      window.worksplitPublic.lifecycle.routers
        .get(id)
        .navigate({ to: "/lab/$name", params: { name: "A" }, search: { view: "latest" } }),
    a,
  );
  await page.waitForFunction(() => window.lifecycleCheck.slowSettled);
  assert.deepEqual(await page.evaluate(() => window.lifecycleCheck.outcomes), ["superseded"]);
  await release("superseded");
  assert.match(page.url(), /view=latest/);
  assert.equal(await input(a).isEnabled(), true);
  record(
    "real native slow navigation settles superseded before its loader releases, and cannot overwrite the later accepted route",
  );

  await page.evaluate((id) => {
    const session = window.worksplitPublic.lifecycle;
    window.lifecycleCheck = {};
    void session.routers
      .get(id)
      .navigate({ to: "/lab/$name", params: { name: "A" }, search: { delay: "closed" } })
      .then(() => {
        window.lifecycleCheck.settled = true;
        return;
      });
  }, a);
  await waitGate("closed");
  await page.getByRole("button", { name: "Close lifecycle", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.lifecycleCheck.settled &&
      window.worksplitPublic.lifecycle.instance.getDocuments().length === 0,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.worksplitPublic.lifecycle.loads.find((load) => load.key === "closed").signal.aborted,
    ),
    true,
  );
  await release("closed");
  assert.equal(
    await page.evaluate(() => window.worksplitPublic.lifecycle.instance.getDocuments().length),
    0,
  );
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(
    await page.evaluate((id) => window.worksplitPublic.lifecycle.activeResources.has(id), a),
    false,
  );
  record(
    "close during a native pending load aborts its real loader, settles the native call, frees content resources and prevents resurrection",
  );

  await reset();
  a = await open("A");
  await input(a).fill("Submitted close draft");
  await page.evaluate((id) => {
    const instance = window.worksplitPublic.lifecycle.instance;
    const first = instance.close(id);
    const second = instance.close(id);
    window.lifecycleCheck = { shared: first === second };
    void first.then((result) => {
      window.lifecycleCheck.result = result;
      return;
    });
  }, a);
  await decision("Save and leave").click();
  await input(a).fill("Newer unsaved close draft");
  await page.waitForFunction(() => window.lifecycleCheck.result);
  assert.equal(await page.evaluate(() => window.lifecycleCheck.shared), true);
  assert.equal(await page.evaluate(() => window.lifecycleCheck.result.status), "denied");
  assert.equal(await input(a).inputValue(), "Newer unsaved close draft");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("worksplit-example:editor:A")),
    "Submitted close draft",
  );
  record(
    "overlapping closes share one decision; saving the captured draft cannot approve newer typing during Save and leave",
  );

  b = await open("B");
  await input(b).fill("Dirty B");
  await page.evaluate(
    async ({ a, b }) => {
      const {
        lifecycle: { instance },
        native: { Actions, DockLocation },
      } = window.worksplitPublic;
      await instance.dispatch(Actions.addTabToNewGroup(a, "Protected editors", "#426b42"));
      await instance.dispatch(
        Actions.moveNode(
          b,
          instance.model.getNodeById(a).getParent().getId(),
          DockLocation.CENTER,
          -1,
        ),
      );
    },
    { a, b },
  );
  await page.getByRole("button", { name: "Close tabset", exact: true }).first().click();
  await page.getByRole("dialog", { name: "Leave A?", exact: true }).waitFor();
  await decision("Leave without saving").click();
  await page.getByRole("dialog", { name: "Leave B?", exact: true }).waitFor();
  assert.equal(await input(a).isDisabled(), true);
  await decision("Keep editing").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => window.worksplitPublic.lifecycle.instance.getDocuments().length),
    2,
  );
  assert.equal(await input(a).isEnabled(), true);
  await activate(a);
  assert.equal(await input(a).inputValue(), "Newer unsaved close draft");
  await activate(b);
  assert.equal(await input(b).inputValue(), "Dirty B");
  await page.getByRole("button", { name: "Close tabset", exact: true }).first().click();
  await decision("Leave without saving").click();
  await page.getByRole("dialog", { name: "Leave B?", exact: true }).waitFor();
  await decision("Leave without saving").click();
  await page.waitForFunction(
    () => window.worksplitPublic.lifecycle.instance.getDocuments().length === 0,
  );
  assert.equal(await page.evaluate(() => window.worksplitPublic.lifecycle.activeResources.size), 1);
  record(
    "native grouped TabSet close approves the whole dirty batch; first-member pause survives the next dialog, rejection closes none and acceptance releases all documents",
  );

  await reset();
  a = await open("A");
  await page.evaluate(
    (id) =>
      window.worksplitPublic.lifecycle.routers
        .get(id)
        .navigate({ to: "/lab/$name", params: { name: "A" }, search: { view: "one" } }),
    a,
  );
  await page.evaluate(
    (id) =>
      window.worksplitPublic.lifecycle.routers
        .get(id)
        .navigate({ to: "/lab/$name", params: { name: "A" }, search: { view: "two" } }),
    a,
  );
  await input(a).fill("Dirty browser history");
  const acceptedHref = page.url();
  const historyLength = await page.evaluate(() => history.length);
  await page.evaluate(() => history.back());
  await page.getByRole("dialog", { name: "Leave A?", exact: true }).waitFor();
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => new URL(location.href).searchParams.get("view") !== "one");
  await decision("Keep editing").click();
  await page.waitForURL(acceptedHref);
  assert.equal(await page.evaluate(() => history.length), historyLength);
  assert.equal(await input(a).inputValue(), "Dirty browser history");
  await page.evaluate(() => history.back());
  await decision("Leave without saving").click();
  await page.waitForFunction(() =>
    window.worksplitPublic.lifecycle.instance.getActiveDocument().href.includes("view=one"),
  );
  assert.equal(await input(a).isEnabled(), true);
  await page.evaluate(() => history.forward());
  await decision("Leave without saving").click();
  await page.waitForFunction(() =>
    window.worksplitPublic.lifecycle.instance.getActiveDocument().href.includes("view=two"),
  );
  assert.equal(await input(a).isEnabled(), true);
  await page.evaluate(() => history.back());
  await page.getByRole("dialog", { name: "Leave A?", exact: true }).waitFor();
  b = await open("B");
  await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 0);
  assert.equal(
    await page.evaluate(() => window.worksplitPublic.lifecycle.instance.getActiveDocument().href),
    "/lab/B",
  );
  assert.equal(new URL(page.url()).pathname, "/lab/B");
  await activate(a);
  assert.equal(await input(a).inputValue(), "Dirty browser history");
  await page.getByRole("button", { name: "Save lifecycle", exact: true }).click();
  await page.waitForFunction(
    () => localStorage.getItem("worksplit-example:editor:A") === "Dirty browser history",
  );
  await page.evaluate(
    (id) =>
      window.worksplitPublic.lifecycle.routers
        .get(id)
        .navigate({ to: "/lab/$name", params: { name: "A" }, search: { view: "three" } }),
    a,
  );
  await page.evaluate(() => history.back());
  await page.waitForURL(/view=two/);
  await page.evaluate(() => history.forward());
  await page.waitForURL(/view=three/);
  record(
    "continuous real browser back denial restores the accepted entry without dropping forward history; dirty approval releases its pause without focus return cancelling it; explicit open cancels a pending traversal, then clean back/forward restores native entries",
  );

  await reset();
  a = await open("A");
  b = await open("B");
  await page.evaluate(
    async ({ a, b }) => {
      const {
        lifecycle: { instance },
        native: { Actions, DockLocation },
      } = window.worksplitPublic;
      await instance.dispatch(
        Actions.moveNode(b, instance.getDocument(a).containerId, DockLocation.RIGHT, -1),
      );
    },
    { a, b },
  );
  const sibling = await input(b).elementHandle();
  await page.evaluate(
    (id) =>
      window.worksplitPublic.lifecycle.routers
        .get(id)
        .navigate({ to: "/lab/$name", params: { name: "A" }, search: { fail: true } }),
    a,
  );
  await page.getByRole("alert").filter({ hasText: "Requested loader failure" }).waitFor();
  await assertRetained(sibling, b);
  await page.evaluate(
    (id) =>
      window.worksplitPublic.lifecycle.routers
        .get(id)
        .navigate({ to: "/lab/$name", params: { name: "A" } }),
    a,
  );
  await input(a).waitFor({ state: "visible" });
  await page.evaluate(
    (id) =>
      window.worksplitPublic.lifecycle.routers
        .get(id)
        .navigate({ to: "/render-error/$name", params: { name: "A" } }),
    a,
  );
  await page.getByRole("alert").filter({ hasText: "Requested renderer failure" }).waitFor();
  await assertRetained(sibling, b);
  assert.equal(
    await page.evaluate(() => window.worksplitPublic.lifecycle.instance.getDocuments().length),
    2,
  );
  record(
    "actual loader and renderer failures stay inside their native Router boundaries and retain the sibling editor DOM and lifetime",
  );

  await reset();
  a = await open("A");
  await input(a).fill("Dirty source A");
  b = await open("B");
  await activate(a);
  const aliasResult = await page.evaluate(() =>
    window.worksplitPublic.lifecycle.instance.open({ to: "/alias/$name", params: { name: "B" } }),
  );
  assert.equal(aliasResult.status, "applied");
  assert.equal(aliasResult.value.document.id, b);
  assert.equal(aliasResult.value.reused, true);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await activate(a);
  await page.evaluate((id) => {
    window.lifecycleCheck = {};
    void window.worksplitPublic.lifecycle.routers
      .get(id)
      .navigate({ to: "/alias/$name", params: { name: "B" } })
      .then(() => {
        window.lifecycleCheck.settled = true;
        return;
      });
  }, a);
  await decision("Leave without saving").click();
  await page.waitForFunction(() => window.lifecycleCheck.settled);
  assert.equal(
    await page.evaluate(() => window.worksplitPublic.lifecycle.instance.getDocuments().length),
    2,
  );
  assert.equal(
    await page.evaluate((id) => window.worksplitPublic.lifecycle.instance.getDocument(id).href, a),
    "/lab/B",
  );
  assert.deepEqual(await page.evaluate(() => window.worksplitPublic.lifecycle.issues), []);
  record(
    "open deduplicates a final redirect without leaving its dirty source; native redirect retains two independent instances sharing the reuse key",
  );

  const finalHref = page.url();
  const histories = await page.evaluate(async () => {
    const session = window.worksplitPublic.lifecycle;
    const routers = [...session.routers.values()];
    await session.dispose();
    return {
      resources: session.activeResources.size,
      ended: routers.every((router) => router.history.signal.aborted),
      documents: session.instance.getDocuments().length,
    };
  });
  assert.deepEqual(histories, { resources: 0, ended: true, documents: 0 });
  assert.equal(page.url(), finalHref);
  record(
    "final disposal destroys each actual document history and releases every mounted resource without an unsolicited browser rewrite",
  );
}
