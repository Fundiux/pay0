const assert = require("node:assert/strict");
const { hugoDateKey, hugoDayBounds, nextDateKey, HUGO_TIME_ZONE } = require("../../functions/lib/modules/agent007/hugoHistory.js");

assert.equal(HUGO_TIME_ZONE, "America/Mexico_City");
assert.equal(hugoDateKey(new Date("2026-09-24T05:59:59.999Z")), "2026-09-23");
assert.equal(hugoDateKey(new Date("2026-09-24T06:00:00.000Z")), "2026-09-24");
assert.equal(hugoDayBounds("2026-09-24").from.toISOString(), "2026-09-24T06:00:00.000Z");
assert.equal(hugoDayBounds("2026-09-24").to.toISOString(), "2026-09-25T06:00:00.000Z");
assert.equal(hugoDayBounds("2021-07-15").from.toISOString(), "2021-07-15T05:00:00.000Z");
assert.equal(nextDateKey("2024-02-28"), "2024-02-29");
assert.equal(nextDateKey("2024-02-29"), "2024-03-01");
assert.throws(() => hugoDayBounds("2026-02-30"), /INVALID_DATE_KEY/);

console.log(JSON.stringify({ ok: true, timezone: HUGO_TIME_ZONE, rollover: true, historicalDst: true }));

