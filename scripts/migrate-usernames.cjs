// Read-only by default. No Auth users, passwords, emails or roles are changed.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const admin = require("../functions/node_modules/firebase-admin");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? "" : args[i + 1] || ""; };
let stage = "VALIDATE_ARGUMENTS";
async function run() {
  let migrationAuth;
  const projectId = option("--project");
  const rootId = option("--root");
  if (!projectId || !rootId) throw Error("Required: --project PROJECT --root ROOT; dry-run also requires --output PATH.");
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    if (!projectId.startsWith("demo-") || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") ||
        !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || "")) throw Error("Use both loopback emulators and a demo project.");
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST && args.includes("--official-gcloud")) {
    stage = "OFFICIAL_CREDENTIAL";
    // End-user gcloud OAuth tokens require an explicit quota project for Auth.
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
    const { execFileSync } = require("node:child_process");
    const { OAuth2Client } = require("../functions/node_modules/google-auth-library");
    const sdk = path.join(process.env.LOCALAPPDATA || "", "Google", "Cloud SDK", "google-cloud-sdk");
    let token = "", expiresAt = 0;
    const credential = { getAccessToken: async () => {
      if (Date.now() >= expiresAt) {
        token = execFileSync(path.join(sdk, "platform", "bundledpython", "python.exe"),
          [path.join(sdk, "lib", "gcloud.py"), "auth", "print-access-token", "--quiet"],
          { encoding: "utf8", windowsHide: true, timeout: 60000 }).trim();
        expiresAt = Date.now() + 45 * 60_000;
      }
      return { access_token: token, expires_in: Math.floor((expiresAt - Date.now()) / 1000) };
    } };
    const access = await credential.getAccessToken(), authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: access.access_token, expiry_date: expiresAt });
    admin.initializeApp({ projectId });
    admin.firestore().settings({ authClient });
    migrationAuth = admin.auth(admin.initializeApp({ projectId, credential }, "username-migration-auth"));
  } else admin.initializeApp({ projectId });
  const { planUsernameMigration, applyUsernameMigration } = require("../functions/lib/modules/users/usernameMigration.js");
  const applyPath = option("--apply");
  if (applyPath) {
    stage = "APPLY_REVIEWED_PLAN";
    const bytes = fs.readFileSync(path.resolve(applyPath));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (option("--confirm-sha256") !== digest) throw Error("Provide the reviewed plan's --confirm-sha256 digest.");
    const count = await applyUsernameMigration(JSON.parse(bytes), projectId, rootId, migrationAuth);
    console.log(JSON.stringify({ ok: true, applied: count, authAccountsChanged: 0, financialActions: 0 }));
  } else {
    stage = "VALIDATE_OUTPUT";
    const output = path.resolve(option("--output") || "");
    const archive = path.resolve(__dirname, "../__untracked_archive/username-migration");
    if (!option("--output") || !output.startsWith(archive + path.sep)) throw Error("Write plans under __untracked_archive/username-migration/ (ignored), never to tracked files.");
    stage = "PLAN_IDENTITIES";
    const plan = await planUsernameMigration({ projectId, rootId, limit: Number(option("--limit") || 50), cursor: option("--cursor") }, migrationAuth);
    stage = "SAVE_PLAN";
    const bytes = JSON.stringify(plan, null, 2) + "\n";
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ ok: true, dryRun: true, planned: plan.assignments.length, skipped: plan.skipped,
      hasMore: !!plan.nextCursor, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), output }));
  }
}
run().catch(error => { console.error(JSON.stringify({ ok: false, stage, code: String(error?.code || error?.name || "ERROR").replace(/[^A-Za-z0-9_/-]/g, "").slice(0, 80), message: "Migration stopped; credentials and account details withheld. A partial apply is safe to retry with the same plan." })); process.exitCode = 1; });
