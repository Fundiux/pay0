const assert = require("node:assert/strict");
const admin = require("../../functions/node_modules/firebase-admin");
const { Timestamp } = admin.firestore;
const contract = require("../../functions/lib/modules/controlCenter/contract.js");
const catalog = require("../../functions/lib/modules/controlCenter/catalog.js");

const periods = contract.getCanonicalPeriodKeys(new Date("2026-01-01T05:30:00.000Z"));
assert.deepEqual(periods, { day: "2025-12-31", week: "2026-W01", month: "2025-12", year: "2025" });

const event = contract.normalizeAnalyticsEvent({
  eventId: "payment-created:pago-1:v1",
  rootId: "root-a",
  eventType: "PAYMENT_CREATED",
  module: "pagos",
  entityType: "pago",
  entityId: "pago-1",
  occurredAt: Timestamp.fromDate(new Date("2026-09-19T18:00:00.000Z")),
  money: { currency: "MXN", grossMinor: 123456 },
  dimensions: { clientId: "client-a", bankId: "bbva" },
  sourceVersion: 1,
});
assert.equal(event.businessDate, "2026-09-19");
assert.equal(event.money.grossMinor, 123456);
assert.equal(event.schemaVersion, 1);

assert.throws(() => contract.normalizeAnalyticsEvent({ ...event, eventId: "", periods: undefined, businessDate: undefined, schemaVersion: undefined }), /IDENTITY_REQUIRED/);
assert.throws(() => contract.normalizeAnalyticsEvent({ ...event, eventId: "bad-money", money: { currency: "MXN", grossMinor: 12.5 }, periods: undefined, businessDate: undefined, schemaVersion: undefined }), /GROSS_MINOR/);

const checked = catalog.validateControlCenterCatalog();
assert.ok(checked.kpis >= 10);
assert.ok(checked.widgets >= 5);
console.log(JSON.stringify({ ok: true, periods, catalog: checked, eventId: event.eventId }, null, 2));
