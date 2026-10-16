const assert = require("node:assert/strict");
const { createJsonFramer } = require("../../scripts/firebase-storage-rules-framing.cjs");
const first = { result: { rulesVersion: 2 }, warnings: Array.from({ length: 80 }, (_, i) => `Advertencia sintética ${i}: raíz, ámbito y versión`), id: 0, errors: [], status: "ok" };
const second = { id: 1, status: "ok", result: { permitted: false } };
const all = Buffer.from(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
let checks = 0;
for (const size of [1, 2, 7, 1024, 4096, all.length]) {
  const received = [], frame = createJsonFramer(chunk => received.push(JSON.parse(chunk.toString("utf8"))));
  for (let cursor = 0; cursor < all.length; cursor += size) frame(all.subarray(cursor, cursor + size));
  assert.deepEqual(received, [first, second]); checks++;
}
const received = [], frame = createJsonFramer(chunk => received.push(JSON.parse(chunk.toString("utf8"))));
const noNewline = Buffer.from(JSON.stringify(second));
frame(noNewline.subarray(0, 5)); assert.equal(received.length, 0); checks++;
frame(noNewline.subarray(5)); assert.deepEqual(received, [second]); checks++;
console.log(JSON.stringify({ result: "PASS", checks, scope: "Storage runtime stdout framing only" }));
