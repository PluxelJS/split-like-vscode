import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../packages/demo/package.json", import.meta.url));
const { createRootRoute, createRoute, createRouter, createMemoryHistory } = await import(
  require.resolve("@tanstack/react-router")
);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalize(value) {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    value.some((id) => typeof id !== "string" || !uuid.test(id))
  )
    throw new Error("Invalid account filter");
  return [...new Set(value.map((id) => id.toLowerCase()))].toSorted();
}
function encode(value) {
  const ids = normalize(value);
  return ids.length ? new URLSearchParams({ accounts: JSON.stringify(ids) }).toString() : "";
}
function decode(hash) {
  if (!hash) return [];
  if (hash.length > 65536) throw new Error("Account filter too long");
  const fields = new URLSearchParams(hash);
  if (
    fields.getAll("accounts").length !== 1 ||
    [...fields.keys()].some((key) => key !== "accounts")
  )
    throw new Error("Invalid account filter");
  return normalize(JSON.parse(fields.get("accounts")));
}
const root = createRootRoute();
const route = createRoute({
  getParentRoute: () => root,
  path: "/journals",
  validateSearch: (search) => ({ view: typeof search.view === "string" ? search.view : "entries" }),
});
const history = createMemoryHistory({ initialEntries: ["/journals?view=entries"] });
const router = createRouter({
  routeTree: root.addChildren([route]),
  history,
  defaultHashScrollIntoView: false,
});
const ids = ["00112233-4455-6677-8899-aabbccddeeff", "11112233-4455-6677-8899-aabbccddeeff"];
const hash = encode(ids);
const built = router.buildLocation({ to: "/journals", search: { view: "entries" }, hash });
history.replace(built.href);
const parsed = router.parseLocation(history.location);
assert.deepEqual(decode(parsed.hash), ids);
process.stdout.write(
  JSON.stringify(
    {
      reactRouter: require("@tanstack/react-router/package.json").version,
      builtHash: built.hash,
      parsedHash: parsed.hash,
      decoded: decode(parsed.hash),
    },
    null,
    2,
  ),
);
process.stdout.write("\n");
const thousand = Array.from(
  { length: 1000 },
  (_, i) => `${i.toString(16).padStart(8, "0")}-4455-6677-8899-aabbccddeeff`,
);
const large = router.buildLocation({
  to: "/journals",
  search: { view: "entries" },
  hash: encode(thousand),
});
history.replace(large.href);
assert.deepEqual(decode(router.parseLocation(history.location).hash), thousand);
assert.deepEqual(decode(encode([ids[1], ids[0].toUpperCase(), ids[0]])), ids);
for (const invalid of [
  "accounts=not-json",
  "accounts=%5B%22not-a-uuid%22%5D",
  "accounts=[]&accounts=[]",
  "unknown=[]",
  encode(thousand) + "&unknown=1",
])
  assert.throws(() => decode(invalid));
assert.throws(() => encode([...thousand, thousand[0]]));
process.stdout.write(
  JSON.stringify(
    {
      accountCount: thousand.length,
      encodedHashLength: encode(thousand).length,
      hrefLength: large.href.length,
      exactRoundTrip: true,
      canonicalization: true,
      invalidInputRejected: true,
      scope:
        "Design probe against locked native Router only; not financial application/browser acceptance",
    },
    null,
    2,
  ),
);
process.stdout.write("\n");
history.destroy();
