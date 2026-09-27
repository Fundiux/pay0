import assert from "node:assert/strict";
import fs from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { buildActivityLogQuery } from "../../src/lib/activityLogQuery.ts";

// Never use production or another runner's fixture project for this regression.
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
  throw new Error("A loopback FIRESTORE_EMULATOR_HOST is required for activity rules tests.");
}
const [host, port] = emulatorHost.split(":");
const env = await initializeTestEnvironment({
  projectId: `demo-pay0-activity-${process.pid}`,
  firestore: { host, port: Number(port), rules: fs.readFileSync("firestore.rules", "utf8") },
});
const collections = ["activityLog", "pay0ActivityLog"];
const actors = [
  { uid: "superA", role: "superadmin" },
  { uid: "adminA", role: "admin" },
  { uid: "operatorA", role: "operador" },
];
let assertions = 0;
const allowed = async (operation) => { assertions += 1; return assertSucceeds(operation); };
const denied = async (operation) => { assertions += 1; return assertFails(operation); };

// Exercise the actual frontend factory; construct incomplete queries only for denials.
function activityQuery(db, collectionName, actor, { rootId = "rootA", includeRoot = true, includeSource = true } = {}) {
  if (includeRoot && includeSource) {
    return buildActivityLogQuery(db, collectionName, { ...actor, rootId, maxRows: 20 });
  }
  const constraints = [];
  if (includeRoot) constraints.push(where("rootId", "==", rootId));
  if (collectionName === "pay0ActivityLog" && includeSource) constraints.push(where("sourceSystem", "==", "PAY0"));
  if (actor.role === "admin") constraints.push(where("adminId", "==", actor.uid));
  if (actor.role === "operador") constraints.push(where("actorUid", "==", actor.uid));
  constraints.push(orderBy("createdAt", "desc"), limit(20));
  return query(collection(db, collectionName), ...constraints);
}

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const actor of actors) {
      await setDoc(doc(db, "users", actor.uid), { role: actor.role, rootId: "rootA", active: true });
    }
    await setDoc(doc(db, "users", "superB"), { role: "superadmin", rootId: "rootB", active: true });
    await setDoc(doc(db, "users", "blockedAdmin"), { role: "admin", rootId: "rootA", modules: { actividad: { view: false } } });
    await setDoc(doc(db, "users", "inactiveAdmin"), { role: "admin", rootId: "rootA", active: false });
    const ownEvent = { rootId: "rootA", adminId: "adminA", actorUid: "operatorA", createdAt: new Date("2026-09-27T12:00:00Z") };
    for (const name of collections) {
      const event = { ...ownEvent, ...(name === "pay0ActivityLog" ? { sourceSystem: "PAY0" } : {}) };
      await setDoc(doc(db, name, "own-older"), event);
      await setDoc(doc(db, name, "own-newer"), { ...event, createdAt: new Date("2026-09-27T13:00:00Z") });
      // Deliberately reuse actor/admin IDs across roots: ownership alone must not grant access.
      await setDoc(doc(db, name, "foreign-root"), { ...event, rootId: "rootB" });
      await setDoc(doc(db, name, "other-actor"), { ...event, adminId: "otherAdmin", actorUid: "otherOperator" });
      const withoutRoot = { ...event };
      delete withoutRoot.rootId;
      await setDoc(doc(db, name, "missing-root"), withoutRoot);
      for (const uid of ["blockedAdmin", "inactiveAdmin"]) {
        await setDoc(doc(db, name, uid), { ...event, adminId: uid, actorUid: uid });
      }
    }
    await setDoc(doc(db, "pay0ActivityLog", "wrong-system"), { ...ownEvent, sourceSystem: "ASSETS" });
    await setDoc(doc(db, "pay0ActivityLog", "missing-system"), ownEvent);
    for (const name of ["assetsActivityLog", "tttActivityLog", "hugoActivityLog"]) {
      await setDoc(doc(db, name, "sibling"), ownEvent);
    }
  });

  for (const name of collections) {
    for (const actor of actors) {
      const db = env.authenticatedContext(actor.uid).firestore();
      const snapshot = await allowed(getDocs(activityQuery(db, name, actor)));
      const ids = snapshot.docs.map((row) => row.id);
      assert.equal(ids[0], "own-newer");
      assert.ok(ids.includes("own-older"));
      assert.ok(!ids.includes("foreign-root"));
      assert.ok(!ids.includes("missing-root"));
      if (actor.role !== "superadmin") assert.deepEqual(ids, ["own-newer", "own-older"]);
      await allowed(getDoc(doc(db, name, "own-older")));
      await denied(getDoc(doc(db, name, "foreign-root")));
      await denied(getDoc(doc(db, name, "missing-root")));
      await denied(getDocs(activityQuery(db, name, actor, { rootId: "rootB" })));
      await denied(getDocs(activityQuery(db, name, actor, { includeRoot: false })));
      if (actor.role !== "superadmin") await denied(getDoc(doc(db, name, "other-actor")));
      if (name === "pay0ActivityLog") {
        // This is the original frontend query: its missing source predicate must fail.
        await denied(getDocs(activityQuery(db, name, actor, { includeSource: false })));
        await denied(getDoc(doc(db, name, "wrong-system")));
        await denied(getDoc(doc(db, name, "missing-system")));
      }
      await denied(setDoc(doc(db, name, `created-${actor.uid}`), { rootId: "rootA", sourceSystem: "PAY0", adminId: actor.uid, actorUid: actor.uid, createdAt: new Date() }));
      await denied(updateDoc(doc(db, name, "own-older"), { description: "not allowed" }));
      await denied(deleteDoc(doc(db, name, "own-older")));
    }
    const foreignDb = env.authenticatedContext("superB").firestore();
    await allowed(getDoc(doc(foreignDb, name, "foreign-root")));
    await denied(getDoc(doc(foreignDb, name, "own-older")));
    for (const uid of ["blockedAdmin", "inactiveAdmin", "missingProfile"]) {
      const db = env.authenticatedContext(uid).firestore();
      await denied(getDocs(activityQuery(db, name, { uid, role: "admin" })));
      await denied(getDoc(doc(db, name, uid === "missingProfile" ? "own-older" : uid)));
    }
    const anonymousDb = env.unauthenticatedContext().firestore();
    await denied(getDocs(activityQuery(anonymousDb, name, actors[0])));
    await denied(getDoc(doc(anonymousDb, name, "own-older")));
  }
  for (const name of ["assetsActivityLog", "tttActivityLog", "hugoActivityLog"]) {
    for (const actor of actors) {
      await denied(getDoc(doc(env.authenticatedContext(actor.uid).firestore(), name, "sibling")));
    }
  }
  console.log(JSON.stringify({ ok: true, assertions, activityCollections: collections, authorizedRoles: 3, crossRootDenied: true, canonicalSourceRequired: true, writesDenied: true, externalActions: 0 }));
} finally {
  try {
    await env.clearFirestore();
  } finally {
    await env.cleanup();
  }
}
