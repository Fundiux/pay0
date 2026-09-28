import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Uso: node scripts/run-firebase-clean-env.mjs <comando firebase> [...args]");
  process.exit(2);
}

const environment = { ...process.env };
delete environment.DEBUG;
const selectedOnlyIndex = args.indexOf("--only");
const selectedOnly = selectedOnlyIndex >= 0 ? args[selectedOnlyIndex + 1] : args.find(arg => arg.startsWith("--only="))?.slice(7);
if (args[0] === "emulators:exec" && String(selectedOnly || "").split(",").includes("storage")) {
  const framingShim = fileURLToPath(new URL("./firebase-storage-rules-framing.cjs", import.meta.url)).replace(/\\/g, "/");
  environment.NODE_OPTIONS = `${environment.NODE_OPTIONS || ""} --require "${framingShim}"`.trim();
}

const firebaseCliCandidates = [
  environment.APPDATA && join(environment.APPDATA, "npm", "node_modules", "firebase-tools", "lib", "bin", "firebase.js"),
  environment.npm_config_prefix && join(environment.npm_config_prefix, "node_modules", "firebase-tools", "lib", "bin", "firebase.js"),
].filter(Boolean);
const firebaseCli = firebaseCliCandidates.find((candidate) => existsSync(candidate));
if (!firebaseCli) {
  console.error("No se encontro la instalacion de Firebase CLI.");
  process.exit(1);
}

const lockPath = join(tmpdir(), "pay0-firebase-emulators.lock");
let lockHandle = null;
let child = null;
let interrupted = false;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // An inaccessible owner is not proof that the lock is stale.
    return error?.code !== "ESRCH";
  }
}

function checkInterrupted() {
  if (interrupted) throw new Error("Ejecucion Firebase interrumpida.");
}

async function recoverStaleLock() {
  const recoveryPath = `${lockPath}.recovery`;
  const startedAt = Date.now();
  let recoveryHandle = null;
  try {
    while (recoveryHandle === null && Date.now() - startedAt < 5_000) {
      checkInterrupted();
      try {
        recoveryHandle = openSync(recoveryPath, "wx");
        writeFileSync(recoveryHandle, String(process.pid));
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const ownerText = readFileSync(recoveryPath, "utf8");
          const owner = Number(ownerText);
          if (/^[1-9]\d*$/.test(ownerText) && Number.isSafeInteger(owner) && !processExists(owner)) {
            throw new Error(`Mutex de recuperacion abandonado en ${recoveryPath} (PID ${owner}). No se elimino automaticamente; requiere inspeccion de propiedad.`);
          }
        } catch (readError) {
          if (readError?.code !== "ENOENT") throw readError;
        }
        await delay(100);
      }
    }
    if (recoveryHandle === null) {
      throw new Error(`Timeout esperando el mutex de recuperacion ${recoveryPath}; se preservo su propietario vivo o desconocido.`);
    }
    // Another contender may already have removed the dead owner's file and
    // acquired a new lock. Re-read ownership only while holding this mutex.
    try {
      const ownerText = readFileSync(lockPath, "utf8");
      const owner = Number(ownerText);
      if (/^[1-9]\d*$/.test(ownerText) && Number.isSafeInteger(owner) && !processExists(owner)) {
        unlinkSync(lockPath);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  } finally {
    if (recoveryHandle !== null) {
      closeSync(recoveryHandle);
      try {
        if (readFileSync(recoveryPath, "utf8") === String(process.pid)) unlinkSync(recoveryPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

async function acquireEmulatorLock() {
  const startedAt = Date.now();
  let lastNoticeAt = 0;
  while (Date.now() - startedAt < 15 * 60_000) {
    checkInterrupted();
    try {
      lockHandle = openSync(lockPath, "wx");
      writeFileSync(lockHandle, String(process.pid));
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let ownerText;
      try {
        ownerText = readFileSync(lockPath, "utf8");
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw readError;
      }
      const owner = Number(ownerText);
      // A new owner's file can briefly be empty between open and write. Never
      // reclaim an empty/invalid lock or treat PID 0 as an individual process.
      if (/^[1-9]\d*$/.test(ownerText) && Number.isSafeInteger(owner) && !processExists(owner)) {
        await recoverStaleLock();
        continue;
      }
      if (Date.now() - lastNoticeAt >= 30_000) {
        console.log(`FIREBASE_EMULATOR_LOCK_WAIT ownerPid=${Number.isSafeInteger(owner) && owner > 0 ? owner : "unknown"}`);
        lastNoticeAt = Date.now();
      }
      await delay(1_000);
    }
  }
  throw new Error("Timeout esperando el lock global de Firebase Emulators.");
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function waitForEmulatorPorts() {
  const onlyIndex = args.indexOf("--only");
  const selected = onlyIndex >= 0 ? String(args[onlyIndex + 1] || "") : "";
  const ports = new Set([4400, 4500]);
  if (!selected || selected.includes("firestore")) {
    ports.add(8080);
    ports.add(9150);
  }
  if (!selected || selected.includes("storage")) ports.add(9199);
  if (!selected || selected.includes("auth")) ports.add(9099);
  const startedAt = Date.now();
  let lastNoticeAt = 0;
  while (Date.now() - startedAt < 15 * 60_000) {
    checkInterrupted();
    const unavailable = [];
    for (const port of ports) if (!(await portIsAvailable(port))) unavailable.push(port);
    if (unavailable.length === 0) return;
    if (Date.now() - lastNoticeAt >= 30_000) {
      console.log(`FIREBASE_EMULATOR_PORT_WAIT ports=${unavailable.join(",")}`);
      lastNoticeAt = Date.now();
    }
    await delay(1_000);
  }
  throw new Error("Timeout esperando puertos libres para Firebase Emulators.");
}

function releaseLock() {
  if (lockHandle === null) return;
  closeSync(lockHandle);
  lockHandle = null;
  try {
    if (Number(readFileSync(lockPath, "utf8")) === process.pid) unlinkSync(lockPath);
  } catch {}
}

function interrupt(signal) {
  interrupted = true;
  process.exitCode = 1;
  // Signal only the child created here. Keep the lock until Firebase has exited;
  // the next run also waits for emulator ports, including delayed shutdowns.
  if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
}
const onSigint = () => interrupt("SIGINT");
const onSigterm = () => interrupt("SIGTERM");

// Install cleanup before acquiring the lock or waiting for occupied ports.
process.once("exit", releaseLock);
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);
try {
  if (args[0] === "emulators:exec") {
    await acquireEmulatorLock();
    await waitForEmulatorPorts();
  }
  checkInterrupted();
  child = spawn(process.execPath, [firebaseCli, ...args], {
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  const result = await new Promise((resolve) => {
    let failure = null;
    child.once("error", (error) => { failure = error; });
    child.once("close", (code, signal) => resolve({ code, signal, failure }));
  });
  if (result.failure) throw result.failure;
  if (result.signal) throw new Error(`Firebase CLI termino por senal ${result.signal}.`);
  process.exitCode = interrupted ? 1 : result.code ?? 1;
} catch (error) {
  console.error(`No se pudo completar Firebase CLI: ${error.message}`);
  process.exitCode = 1;
} finally {
  releaseLock();
  process.removeListener("exit", releaseLock);
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
}
