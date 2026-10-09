const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const projectId = process.env.GCLOUD_PROJECT || "";
if (!projectId.startsWith("demo-") || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || "")) throw Error("Both local emulators and a demo project are required.");
const originalFetch = global.fetch;
let authRequests = 0;
global.fetch = (url, options) => {
  const parsed = new URL(typeof url === "string" ? url : url.url || url.toString());
  assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname), "No external HTTP calls are allowed");
  if (parsed.pathname.includes("accounts:signInWithPassword")) authRequests++;
  return originalFetch(url, options);
};
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId });
const db = admin.firestore();
const api = require("../../functions/lib/modules/users/loginIdentity.js");
const migration = require("../../functions/lib/modules/users/usernameMigration.js");
const { initializeApp, deleteApp } = require("firebase/app");
const authSdk = require("firebase/auth");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const rootDir = path.resolve(__dirname, "../..");
const testRoot = `auth-fixture-${Date.now()}`;
const password = "Fixture-initial-938!";
const nextPassword = "Fixture-updated-726!";
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function compile(file, imports = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(rootDir, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => {
    if (!(name in imports)) throw Error(`Unexpected module: ${name}`);
    return imports[name];
  }, console: { error: () => { throw Error("Credentials must not reach logs"); } } });
  return exports;
}
async function fixture(suffix, fields = {}) {
  const uid = `${testRoot}-${suffix}`;
  const user = await admin.auth().createUser({ uid, email: `${suffix}.${testRoot}@example.test`, password });
  await db.doc(`users/${uid}`).set({ rootId: testRoot, role: "operador", isActive: true, displayName: "Nombre compartido", ...fields });
  return user;
}
async function run() {
  const owner = await fixture("owner", { role: "superadmin", email: "spoofed-profile@example.test" });
  const other = await fixture("other");
  const disabled = await fixture("disabled", { isActive: false });
  const deleted = await fixture("deleted", { isDeleted: true });
  const legacyInactive = [];
  for (const [flag, value] of [["disabled", true], ["deleted", true], ["deletedAt", admin.firestore.Timestamp.now()]]) {
    const user = await fixture(`legacy-${flag}`, { [flag]: value });
    await api.assignLoginUsername({ uid: user.uid, rootId: testRoot, username: `legacy.${flag.toLowerCase()}` });
    legacyInactive.push(`legacy.${flag.toLowerCase()}`);
  }
  const sandboxClient = initializeApp({ apiKey: "local-test-only", projectId }, "username-fixture");
  const auth = authSdk.getAuth(sandboxClient);
  authSdk.connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(path.join(rootDir, "firestore.rules"), "utf8") } });
  try {
    const normalized = api.normalizeLoginUsername("  Ｐay0.Owner  ");
    check(normalized === "pay0.owner", "NFKC, trim and case normalization");
    for (const bad of ["ab", "../x", "user@email.test", "-alias", "alias-", "a".repeat(33)]) assert.throws(() => api.normalizeLoginUsername(bad));
    await api.assignLoginUsername({ uid: owner.uid, rootId: testRoot, username: "pay0.owner" });
    await api.assignLoginUsername({ uid: disabled.uid, rootId: testRoot, username: "disabled.user" });
    await api.assignLoginUsername({ uid: deleted.uid, rootId: testRoot, username: "deleted.user" });
    await assert.rejects(api.assignLoginUsername({ uid: other.uid, rootId: testRoot, username: "PAY0.OWNER" }), /disponible/);
    await assert.rejects(api.assignLoginUsername({ uid: other.uid, rootId: "foreign-root", username: "foreign.user" }), /alcance/);
    checks += 2;

    const request = (username, pass = password, ip = "127.0.0.10") => ({ data: { username, password: pass }, rawRequest: { ip } });
    const success = await api.authenticateLoginUsername(request("PAY0.Owner"));
    check(Object.keys(success).join() === "customToken", "Only a custom token is returned; no email/UID directory");
    await authSdk.signInWithCustomToken(auth, success.customToken);
    check(auth.currentUser.uid === owner.uid, "Token signs into the existing Auth UID");
    check(auth.currentUser.email === owner.email, "Authoritative Auth email wins over spoofed profile email");
    const failures = [];
    for (const username of legacyInactive) {
      await assert.rejects(api.authenticateLoginUsername(request(username)), error => error.code === "unauthenticated");
      checks++;
    }
    for (const [name, pass] of [["missing.user", password], ["pay0.owner", "wrong-fixture-password"], ["disabled.user", password], ["deleted.user", password]]) {
      try { await api.authenticateLoginUsername(request(name, pass)); assert.fail("Expected login rejection"); }
      catch (error) { failures.push({ code: error.code, message: error.message }); }
    }
    check(failures.every(value => value.code === failures[0].code && value.message === failures[0].message), "Unknown, wrong, disabled and deleted identities have identical errors");

    const frontendValidation = compile("src/lib/accountValidation.ts");
    check(frontendValidation.normalizeAccountUsername(" Ｐay0.Owner ") === normalized, "Browser/server normalization matches");
    const frontendAuth = compile("src/lib/auth.ts", {
      react: {}, "firebase/auth": authSdk, "@/lib/firebaseClient": { auth },
      "@/services/activityLogMutations": { logAuthEventMutation: async () => {} },
      "@/services/loginIdentity": { authenticateWithUsername: (username, pass) => api.authenticateLoginUsername(request(username, pass)) },
      "@/lib/accountValidation": frontendValidation,
    });
    const profileBefore = (await db.doc(`users/${owner.uid}`).get()).data();
    await assert.rejects(frontendAuth.changeMyPassword(password, nextPassword, "mismatch"));
    await assert.rejects(frontendAuth.changeMyPassword("wrong-fixture-password", nextPassword, nextPassword));
    await frontendAuth.changeMyPassword(password, nextPassword, nextPassword);
    check(JSON.stringify((await db.doc(`users/${owner.uid}`).get()).data()) === JSON.stringify(profileBefore), "Password change does not write to Firestore");
    await authSdk.signOut(auth);
    await assert.rejects(authSdk.signInWithEmailAndPassword(auth, owner.email, password));
    await frontendAuth.loginWithIdentifier(owner.email, nextPassword);
    check(auth.currentUser.uid === owner.uid, "Email compatibility and the new password work");
    await authSdk.signOut(auth);
    await frontendAuth.loginWithIdentifier("pay0.owner", nextPassword);
    check(auth.currentUser.uid === owner.uid, "Username login accepts the changed password");

    const expiredAuth = { uid: owner.uid, token: { auth_time: Math.floor(Date.now() / 1000) - 600 } };
    await assert.rejects(api.setMyUsername.run({ auth: expiredAuth, data: { username: "owner.renamed" } }), /Confirma/);
    await assert.rejects(api.setMyUsername.run({ data: { username: "owner.renamed" } }), /sesión/);
    const renamed = await api.setMyUsername.run({ auth: { uid: owner.uid, token: { auth_time: Math.floor(Date.now() / 1000) } }, data: { username: "Owner.Renamed", uid: other.uid } });
    check(renamed.username === "owner.renamed" && (await db.doc(`users/${other.uid}`).get()).data().username === undefined, "Self-service ignores spoofed target UID");
    await assert.rejects(api.authenticateLoginUsername(request("pay0.owner", nextPassword)));
    await assert.rejects(api.assignLoginUsername({ uid: other.uid, rootId: testRoot, username: "pay0.owner" }), /disponible/);
    checks += 2;

    const concurrent = await Promise.allSettled(["create-one", "create-two"].map(suffix => api.createUserWithLogin({
      email: `${suffix}.${testRoot}@example.test`, password, username: "same.creation", rootId: testRoot,
    })));
    check(concurrent.filter(result => result.status === "fulfilled").length === 1, "Concurrent username creation has exactly one owner");
    const created = concurrent.find(result => result.status === "fulfilled").value;
    await api.discardUnpublishedLoginUser(created.user.uid, created.username);
    check(!(await api.loginUsernameRef(created.username).get()).exists, "Unpublished account compensation releases only its reservation");

    const plan = await migration.planUsernameMigration({ projectId, rootId: testRoot, limit: 100 });
    check(new Set(plan.assignments.map(row => row.username)).size === plan.assignments.length, "Migration resolves duplicate display names");
    check(!JSON.stringify(plan).includes("@example.test") && !JSON.stringify(plan).includes(password), "Migration plan excludes emails/passwords");
    check((await db.doc(`users/${other.uid}`).get()).data().username === undefined, "Planning is read-only");
    await assert.rejects(migration.applyUsernameMigration(plan, projectId, "foreign-root"));
    await migration.applyUsernameMigration(plan, projectId, testRoot);
    await migration.applyUsernameMigration(plan, projectId, testRoot);
    check(!!(await db.doc(`users/${other.uid}`).get()).data().usernameNormalized, "Migration is applicable and repeatable");

    for (let i = 0; i < 19; i++) await api.consumeUsernameLoginAttempt("limit.fixture", "limit-ip", 1_000_000);
    const last = await Promise.allSettled([api.consumeUsernameLoginAttempt("limit.fixture", "limit-ip", 1_000_000), api.consumeUsernameLoginAttempt("limit.fixture", "limit-ip", 1_000_000)]);
    check(last.filter(result => result.status === "fulfilled").length === 1 && last.some(result => result.status === "rejected" && result.reason.code === "resource-exhausted"), "Rate limit remains atomic under concurrent attempts");
    await api.consumeUsernameLoginAttempt("limit.fixture", "limit-ip", 2_000_000);
    checks++;

    for (const context of [env.unauthenticatedContext(), env.authenticatedContext(owner.uid)]) {
      for (const collection of ["authUsernames", "authLoginLimits"]) {
        await assertFails(getDoc(doc(context.firestore(), collection, "fixture")));
        await assertFails(setDoc(doc(context.firestore(), collection, "fixture"), { uid: owner.uid }));
        checks += 2;
      }
    }
    for (const collection of ["users", "authUsernames", "authLoginLimits"]) {
      const values = JSON.stringify((await db.collection(collection).get()).docs.map(row => row.data()));
      check(!values.includes(password) && !values.includes(nextPassword), `No password stored in ${collection}`);
    }
    check(authRequests > 0, "Actual Auth emulator verified credentials");
    console.log(JSON.stringify({ ok: true, checks, authAndFirestoreEmulators: true, productionAuthCalls: 0, externalActions: 0 }));
  } finally { await env.cleanup(); await deleteApp(sandboxClient); }
}
run().then(() => process.exit(0)).catch(error => { console.error(`USERNAME_AUTH_TEST_FAIL ${error.code || ""} ${error.message || "assertion"}`); process.exit(1); });
