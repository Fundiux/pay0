// Run without --apply to inspect the exact production calendar change.
// The CNBV 2026 holiday list is published in its 10 December 2025 notice.
const admin = require("firebase-admin");

const rootId = "Ab4z0RttIqXbZFT0NuWsDjBkt6J2";
const holidays2026 = [
  "2026-01-01", "2026-02-02", "2026-03-16", "2026-04-02",
  "2026-04-03", "2026-05-01", "2026-09-16", "2026-11-02",
  "2026-11-16", "2026-12-12", "2026-12-25",
];
const intervals = {
  solicitudCreate: 1,
  pagoCreate: 1,
  solicitudReconciliation: 20,
};

async function main() {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "pay-0-system",
  });
  const ref = admin.firestore().collection("iqIntegrationConfigs").doc(rootId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("IQ_CONFIG_NOT_FOUND");
  const current = snap.data() || {};
  const holidays = Array.from(new Set([
    ...(Array.isArray(current.holidays) ? current.holidays : []),
    ...holidays2026,
  ])).sort();
  const next = {
    "intervalMinutes.solicitudCreate": intervals.solicitudCreate,
    "intervalMinutes.pagoCreate": intervals.pagoCreate,
    "intervalMinutes.solicitudReconciliation": intervals.solicitudReconciliation,
    holidays: admin.firestore.FieldValue.arrayUnion(...holidays2026),
  };
  console.log(JSON.stringify({
    projectId: "pay-0-system",
    rootId,
    before: {
      intervalMinutes: current.intervalMinutes,
      holidays: current.holidays,
    },
    after: {
      intervalMinutes: { ...current.intervalMinutes, ...intervals },
      holidays,
    },
  }, null, 2));
  if (!process.argv.includes("--apply")) return;
  await ref.update(next);
  console.log("IQ_CONFIG_UPDATED");
}

main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
