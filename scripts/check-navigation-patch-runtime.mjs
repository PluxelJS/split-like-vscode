/** Verify changed native request code is generated from the shipped TypeScript.
 * Run against the same workspace or independent installation as the regression.
 * This intentionally compares generated code, not a handful of marker strings.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";

const requireConsumer = createRequire(resolve(process.argv[2] ?? "packages/react", "package.json"));
const requireRouter = createRequire(requireConsumer.resolve("@tanstack/react-router"));
const core = dirname(requireRouter.resolve("@tanstack/router-core/package.json"));
const history = dirname(requireRouter.resolve("@tanstack/history/package.json"));
const strip = (source) => stripTypeScriptTypes(source, { mode: "transform" });
const slice = (source, start, end) => {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, `Missing source boundary: ${start}`);
  return source.slice(begin, finish);
};

const routerSource = await readFile(resolve(core, "src/router.ts"), "utf8");
const loadSource = await readFile(resolve(core, "src/load-client.ts"), "utf8");
const memorySource = await readFile(resolve(history, "src/index.ts"), "utf8");
let checked = 0;
const runtimeFormats = await Promise.all(
  [
    ["esm", "js"],
    ["cjs", "cjs"],
  ].map(async ([kind, ext]) => {
    const [routerRuntime, loadRuntime, memoryRuntime] = await Promise.all([
      readFile(resolve(core, `dist/${kind}/router.${ext}`), "utf8"),
      readFile(resolve(core, `dist/${kind}/load-client.${ext}`), "utf8"),
      readFile(resolve(history, `dist/${kind}/index.${ext}`), "utf8"),
    ]);
    return { kind, routerRuntime, loadRuntime, memoryRuntime };
  }),
);
for (const { kind, routerRuntime, loadRuntime, memoryRuntime } of runtimeFormats) {
  for (const [name, start, end] of [
    ["commitLocation", "  commitLocation: CommitLocationFn =", "  /** Convenience helper:"],
    ["buildAndCommitLocation", "  buildAndCommitLocation =", "  /**\n   * Imperatively navigate"],
    ["load", "  load: LoadFn =", "\n  startViewTransition ="],
  ]) {
    let generated = strip(`class C { ${slice(routerSource, start, end)} }`);
    generated = generated.slice(generated.indexOf(`${name} =`), generated.lastIndexOf("}")).trim();
    if (kind === "cjs") {
      for (const [from, to] of [
        ["isServer", "_tanstack_router_core_isServer.isServer"],
        ["loadServerRoute", "_tanstack_router_core_isServer.loadServerRoute"],
        ["loadClientRoute", "require_load_client.loadClientRoute"],
        ["trimPathRight", "require_path.trimPathRight"],
        ["deepEqual", "require_utils.deepEqual"],
      ])
        generated = generated.replace(new RegExp(`\\b${from}\\b`, "g"), to);
      // The public instance member is not an imported symbol.
      generated = generated.replaceAll(
        "this._tanstack_router_core_isServer.isServer",
        "this.isServer",
      );
    }
    assert.ok(
      routerRuntime.includes(`this.${generated}`),
      `${kind} Router.${name} differs from its source`,
    );
    checked++;
  }
  for (const [start, end] of [
    ["export async function loadClientRoute(", "export async function refreshClientRoute("],
    ["function followRedirect(", "async function runBackground("],
    ["async function runClientTransaction(", "export async function loadClientRoute("],
  ]) {
    let generated = strip(slice(loadSource, start, end)).replace(
      "export async function",
      "async function",
    );
    if (kind === "cjs")
      generated = generated.replaceAll(
        "getLocationChangeInfo(",
        "require_router.getLocationChangeInfo(",
      );
    assert.ok(loadRuntime.includes(generated.trim()), `${kind} ${start} differs from its source`);
    checked++;
  }
  const generated = strip(
    slice(memorySource, "export function createMemoryHistory(", "const noop ="),
  ).replace("export function createMemoryHistory", "function createMemoryHistory");
  assert.ok(
    memoryRuntime.includes(generated.trim()),
    `${kind} memory history differs from its source`,
  );
  checked++;
}
process.stdout.write(
  `${JSON.stringify({ generatedNativeImplementations: checked, formats: ["esm", "commonjs"] })}\n`,
);
