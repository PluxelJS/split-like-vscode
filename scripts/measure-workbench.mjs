import { writeFile } from "node:fs/promises";
import os from "node:os";

import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const results = [];
for (const count of [2, 10, 50]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let httpRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/documents/")) ++httpRequests;
  });
  await page.goto(
    `${process.env.WORKSPLIT_URL ?? "http://127.0.0.1:5188"}/documents/bench0?view=edit&delay=0`,
  );
  await page.getByLabel("Draft bench0").waitFor();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const beforeHeap = await cdp.send("Performance.getMetrics");
  const sample = await page.evaluate(async (number) => {
    const { workbench, getMetrics, open } = window.worksplitDemo;
    const frames = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const start = performance.now();
    for (let index = 1; index < number; ++index) {
      await open(`bench${index}`, index % 2 ? "right" : "left");
      await frames();
    }
    await frames();
    const openMs = performance.now() - start;
    const opened = getMetrics();
    const ids = workbench.getDocuments().map((document) => document.id);
    const switchedAt = performance.now();
    for (let index = 0; index < 20; ++index) {
      workbench.activate(ids[index % ids.length]);
      await frames();
    }
    const switchMs = performance.now() - switchedAt;
    const switched = getMetrics();
    return { count: number, openMs, switchCount: 20, switchMs, opened, switched };
  }, count);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(100);
  const closing = await page.evaluate(async () => {
    const { workbench, getMetrics } = window.worksplitDemo;
    const resized = getMetrics();
    const closeAt = performance.now();
    const receipts = [];
    for (const doc of workbench.getDocuments()) receipts.push(await workbench.close(doc.id));
    const closeReceiptMs = performance.now() - closeAt;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      resized,
      closeReceiptMs,
      closeWithFramesMs: performance.now() - closeAt,
      closed: getMetrics(),
      remaining: workbench.getDocuments().length,
      closeResults: receipts.map((r) => ({
        status: r.status,
        errors: r.cleanupErrors?.length ?? 0,
      })),
    };
  });
  const afterHeap = await cdp.send("Performance.getMetrics");
  const heap = (measurement) =>
    measurement.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;
  results.push({
    ...sample,
    ...closing,
    httpRequests,
    heapBeforeBytes: heap(beforeHeap),
    heapAfterCloseBytes: heap(afterHeap),
  });
  await context.close();
}
await writeFile(
  "refactor/acceptance/measurements.json",
  JSON.stringify(
    {
      environment: {
        browser: browser.version(),
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model,
        server:
          "Vite development, local HTTP, warm server/module cache, separate cold browser contexts",
        viewport: "1440x900",
        conditions:
          "One real fetch per loader, zero injected delay, staleTime Infinity, two visible groups, every opened document displayed before proceeding; 2 RAF waits per open/switch. Render counts are committed effects, not speculative render attempts. Heap has no forced GC and cannot demonstrate absence of leaks.",
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
      ({ count, httpRequests, opened, switched, closed, openMs, switchMs, closeReceiptMs }) => ({
        count,
        httpRequests,
        renders: opened.renders,
        switchRenders: switched.renders - opened.renders,
        subscriptions: opened.subscriptions,
        closedSubscriptions: closed.subscriptions,
        liveRoutersAfterClose: closed.liveRouters,
        openMs,
        switchMs,
        closeReceiptMs,
      }),
    ),
    null,
    2,
  ) + "\n",
);
await browser.close();
