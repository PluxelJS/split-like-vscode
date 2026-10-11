/* eslint-disable no-await-in-loop -- Sequential operations and two-frame settlements are the measured workload. */
import { writeFile } from "node:fs/promises";
import os from "node:os";

import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const results = [];
const baseURL = process.env.WORKSPLIT_URL ?? "http://127.0.0.1:5188";
const heap = (measurement) =>
  measurement.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;

try {
  for (const count of [2, 10, 50]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      let httpRequests = 0;
      page.on("request", (request) => {
        if (request.url().includes("/api/documents/")) ++httpRequests;
      });
      await page.goto(`${baseURL}/documents/bench0?view=edit&delay=0`);
      await page.getByLabel("Draft bench0").waitFor();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      const beforeHeap = await cdp.send("Performance.getMetrics");
      const sample = await page.evaluate(async (number) => {
        const { workbench, getMetrics, open, openBeside, Actions, DockLocation } =
          window.worksplitDemo;
        const raf = window.requestAnimationFrame.bind(window);
        const frames = () => new Promise((resolve) => raf(() => raf(resolve)));
        const started = getMetrics();
        const openAt = performance.now();
        const seeds = [workbench.getDocuments()[0].id];
        const containerId = (id) => {
          const contains = (node) =>
            node.id === id || (node.children ?? []).some((child) => contains(child));
          const find = (node) =>
            node.type === "tabset" && contains(node)
              ? node.id
              : (node.children ?? []).map(find).find(Boolean);
          const target = find(workbench.getLayout().layout);
          if (!target) throw new Error(`Missing current native container for ${id}`);
          return target;
        };
        let openTargetLookupMs = 0;
        for (let index = 1; index < number; ++index) {
          let receipt;
          if (index === 1) {
            receipt = await openBeside(`bench${index}`);
            seeds.push(workbench.getDocuments().find((doc) => doc.href.includes("/bench1?")).id);
          } else {
            const lookupAt = performance.now();
            const target = containerId(seeds[index % 2]);
            openTargetLookupMs += performance.now() - lookupAt;
            receipt = await open(`bench${index}`, target);
          }
          if (receipt.status !== "committed")
            throw new Error(`Open bench${index}: ${JSON.stringify(receipt)}`);
          await frames();
          const input = document.querySelector(`[aria-label="Draft bench${index}"]`);
          if (!input?.getClientRects().length || getComputedStyle(input).visibility !== "visible")
            throw new Error(`bench${index} was not displayed before the next open`);
        }
        await frames();
        const openMs = performance.now() - openAt;
        const opened = getMetrics();
        const ids = workbench.getDocuments().map((document) => document.id);
        const names = ["Bench left", "Bench right"];
        const groupAt = performance.now();
        const createAt = performance.now();
        const createReceipt = await workbench.dispatch(
          Actions.group(
            seeds.map((id, index) => Actions.addTabToNewGroup(id, names[index], "#94b870")),
          ),
        );
        const createReceiptMs = performance.now() - createAt;
        if (createReceipt.status !== "applied")
          throw new Error(`Create native groups: ${JSON.stringify(createReceipt)}`);
        // This public JSON clone and lookup is timed within grouping, not hidden setup work.
        const lookupAt = performance.now();
        const json = workbench.getLayout();
        const nativeNodes = [];
        const collectNodes = (node) => {
          nativeNodes.push(node);
          for (const child of node.children ?? []) collectNodes(child);
        };
        collectNodes(json.layout);
        const groups = names.map((name) => {
          const node = nativeNodes.find(
            (child) => child.type === "tabgroup" && child.name === name,
          );
          if (!node) throw new Error(`Missing native group ${name}`);
          return { id: node.id, name };
        });
        const groupLookupMs = performance.now() - lookupAt;
        const joins = ids
          .slice(2)
          .map((id, index) => Actions.moveNode(id, groups[index % 2].id, DockLocation.CENTER, -1));
        const joinAt = performance.now();
        const joinReceipt = joins.length ? await workbench.dispatch(Actions.group(joins)) : null;
        const joinReceiptMs = performance.now() - joinAt;
        if (joinReceipt && joinReceipt.status !== "applied")
          throw new Error(`Join native groups: ${JSON.stringify(joinReceipt)}`);
        await frames();
        const grouping = {
          nativeGroupCount: groups.length,
          createActionCount: seeds.length,
          joinActionCount: joins.length,
          batchCount: joins.length ? 2 : 1,
          createReceiptMs,
          joinReceiptMs,
          groupLookupMs,
          totalWithFramesMs: performance.now() - groupAt,
          createReceipt,
          joinReceipt,
          grouped: getMetrics(),
        };
        const collapsedAt = performance.now();
        const collapseReceipts = [];
        let collapseReceiptMs = 0;
        for (let cycle = 0; cycle < 20; ++cycle) {
          for (const openedState of [false, true]) {
            const receiptAt = performance.now();
            const receipt = await workbench.dispatch(
              Actions.group(
                groups.map((group) =>
                  Actions.updateNodeAttributes(group.id, { opened: openedState }),
                ),
              ),
            );
            collapseReceiptMs += performance.now() - receiptAt;
            collapseReceipts.push(receipt);
            if (receipt.status !== "applied")
              throw new Error(`Collapse/expand native groups: ${JSON.stringify(receipt)}`);
            await frames();
          }
        }
        const collapseExpand = {
          cycles: 20,
          batchCount: collapseReceipts.length,
          nodeAttributeActionCount: collapseReceipts.length * groups.length,
          receiptMs: collapseReceiptMs,
          totalWithFramesMs: performance.now() - collapsedAt,
          receipts: collapseReceipts,
          after: getMetrics(),
        };
        const moveAt = performance.now();
        const moveReceipts = [];
        let moveReceiptMs = 0;
        let moveTargetLookupMs = 0;
        for (let index = 0; index < groups.length; ++index) {
          const group = groups[index];
          const otherGroup = groups[1 - index];
          for (const location of ["CENTER", index === 0 ? "LEFT" : "RIGHT"]) {
            const targetLookupAt = performance.now();
            const target = containerId(otherGroup.id);
            moveTargetLookupMs += performance.now() - targetLookupAt;
            const receiptAt = performance.now();
            const receipt = await workbench.dispatch(
              Actions.group([Actions.moveNode(group.id, target, DockLocation[location], -1)]),
            );
            moveReceiptMs += performance.now() - receiptAt;
            moveReceipts.push({ groupId: group.id, target, location, receipt });
            if (receipt.status !== "applied")
              throw new Error(`Move native group: ${JSON.stringify(receipt)}`);
            await frames();
          }
        }
        const movement = {
          groupCount: groups.length,
          batchCount: moveReceipts.length,
          nodeMoveActionCount: moveReceipts.length,
          receiptMs: moveReceiptMs,
          targetLookupMs: moveTargetLookupMs,
          totalWithFramesMs: performance.now() - moveAt,
          receipts: moveReceipts,
          after: getMetrics(),
        };
        const switchedAt = performance.now();
        for (let index = 0; index < 20; ++index) {
          workbench.activate(ids[index % ids.length]);
          await frames();
        }
        return {
          count: number,
          started,
          openMs,
          openTargetLookupMs,
          opened,
          grouping,
          collapseExpand,
          movement,
          switching: {
            count: 20,
            totalWithFramesMs: performance.now() - switchedAt,
            after: getMetrics(),
          },
        };
      }, count);
      const afterLayoutHeap = await cdp.send("Performance.getMetrics");
      const closing = await page.evaluate(async () => {
        const { workbench, getMetrics, Actions } = window.worksplitDemo;
        const raf = window.requestAnimationFrame.bind(window);
        const closeAt = performance.now();
        const lookupAt = performance.now();
        const targets = [];
        const collectTargets = (node) => {
          if (node.type === "tabset" && node.children?.length) targets.push(node.id);
          for (const child of node.children ?? []) collectTargets(child);
        };
        collectTargets(workbench.getLayout().layout);
        const targetLookupMs = performance.now() - lookupAt;
        if (targets.length !== 2)
          throw new Error(`Expected two non-empty native TabSets: ${targets}`);
        const receiptAt = performance.now();
        const receipt = await workbench.dispatch(
          Actions.group(targets.map((id) => Actions.deleteTabset(id))),
        );
        const closeReceiptMs = performance.now() - receiptAt;
        await new Promise((resolve) => raf(() => raf(resolve)));
        const result = {
          batchCount: 1,
          tabsetDeleteActionCount: targets.length,
          targetLookupMs,
          closeReceiptMs,
          closeWithFramesMs: performance.now() - closeAt,
          closed: getMetrics(),
          remaining: workbench.getDocuments().length,
          receipt: {
            status: receipt.status,
            id: receipt.id,
            reason: receipt.reason,
            cleanupErrors: (receipt.cleanupErrors ?? []).map((error) => String(error)),
            error: receipt.error === undefined ? undefined : String(receipt.error),
          },
        };
        if (receipt.status !== "closed" || result.remaining !== 0)
          throw new Error(
            `Native batch close did not close all documents: ${JSON.stringify(result)}`,
          );
        return result;
      });
      const afterCloseHeap = await cdp.send("Performance.getMetrics");
      const disposal = await page.evaluate(async () => {
        const { workbench, getMetrics } = window.worksplitDemo;
        const raf = window.requestAnimationFrame.bind(window);
        const disposeAt = performance.now();
        const errors = await workbench.dispose();
        const disposeReceiptMs = performance.now() - disposeAt;
        await new Promise((resolve) => raf(() => raf(resolve)));
        return {
          disposeReceiptMs,
          disposeWithFramesMs: performance.now() - disposeAt,
          cleanupErrors: errors.map((error) => String(error)),
          disposed: getMetrics(),
        };
      });
      const afterDisposeHeap = await cdp.send("Performance.getMetrics");
      results.push({
        ...sample,
        closing,
        disposal,
        httpRequests,
        heapBeforeBytes: heap(beforeHeap),
        heapAfterLayoutBytes: heap(afterLayoutHeap),
        heapAfterCloseBytes: heap(afterCloseHeap),
        heapAfterDisposeBytes: heap(afterDisposeHeap),
      });
    } finally {
      await context.close();
    }
  }
  await writeFile(
    "refactor/acceptance/native-measurements.json",
    JSON.stringify(
      {
        environment: {
          measuredAt: new Date().toISOString(),
          browser: browser.version(),
          node: process.version,
          platform: `${os.platform()} ${os.arch()}`,
          cpu: os.cpus()[0]?.model,
          baseURL,
          server:
            "Vite development, local HTTP, warm server/module cache, separate cold browser contexts",
          viewport: "1440x900",
          conditions: [
            "One real fetch per loader; zero injected delay; staleTime Infinity; two native TabSets; every opened document displayed before proceeding.",
            "Append-open time excludes the first startup document and includes two RAF waits per open plus one final two-RAF settlement. The first appended document uses openBeside and a native RIGHT split; later opens locate each seed document's current TabSet through public getLayout clones and traversal. Lookup time is included and also reported separately. All counters include the first document.",
            "Groups are made with native Actions.group; no allowDrop callback. Grouping time includes one public getLayout JSON clone and traversal to find auto-generated native group ids; that lookup is also reported separately.",
            "20 collapse/expand cycles affect both groups: 40 native GROUP batches and 80 attribute Actions, with two RAF waits after every batch.",
            "Each native group moves CENTER into the other group’s current TabSet, allowing FlexLayout to prune its emptied source; its return uses native LEFT/RIGHT to create a fresh TabSet. Four native GROUP batches/MoveNode Actions wait two RAF each. Public getLayout clone/traversal to resolve targets after pruning is included in movement time and reported separately. Document ids are then selected round-robin 20 times with two RAF waits each.",
            "Close resolves the two current non-empty TabSets from public getLayout, then uses a single native GROUP containing DELETE_TABSET for both. Lookup time is included in closeWithFramesMs and reported separately; closeReceiptMs measures only dispatch. Clean documents have no confirmation delay. instance.dispose is measured afterwards.",
            "Render counters are business component committed effects, not speculative attempts or all shell/native renders. Subscription counters cover demo business services and public history.subscribers, not all Router/Store internals.",
            "One sample per document count. RAF waits, dev tooling, shell updates, local scheduling and JSON work are included; durations are not pure CPU costs, production throughput or P95 comparisons.",
            "CDP Performance heap readings have no forced GC and are diagnostic observations, not proof of absence of leaks. The Inspector and host React root remain mounted until the browser context closes.",
          ],
        },
        results,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(
    JSON.stringify(
      results.map(
        ({
          count,
          httpRequests,
          opened,
          grouping,
          collapseExpand,
          movement,
          switching,
          closing,
          disposal,
        }) => ({
          count,
          httpRequests,
          loaderRequests: opened.requests,
          renders: opened.renders,
          groupingMs: grouping.totalWithFramesMs,
          groupLookupMs: grouping.groupLookupMs,
          collapseExpandMs: collapseExpand.totalWithFramesMs,
          movementMs: movement.totalWithFramesMs,
          switchMs: switching.totalWithFramesMs,
          layoutAdditionalLoaderRequests: switching.after.requests - opened.requests,
          layoutAdditionalRenders: switching.after.renders - opened.renders,
          layoutAdditionalMounts: switching.after.mounts - opened.mounts,
          closeReceiptMs: closing.closeReceiptMs,
          closeWithFramesMs: closing.closeWithFramesMs,
          closeStatus: closing.receipt.status,
          closeCleanupErrors: closing.receipt.cleanupErrors.length,
          closedSubscriptions: closing.closed.subscriptions,
          closedHistorySubscriptions: closing.closed.historySubscriptions,
          closedLiveRouters: closing.closed.liveRouters,
          unmounts: closing.closed.unmounts,
          disposedSubscriptions: disposal.disposed.subscriptions,
          disposedHistorySubscriptions: disposal.disposed.historySubscriptions,
          disposedLiveRouters: disposal.disposed.liveRouters,
          disposeCleanupErrors: disposal.cleanupErrors.length,
        }),
      ),
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
