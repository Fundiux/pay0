import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";

const forbiddenEnvironment = /^(?:GITHUB|ACTIONS|GOOGLE|GCLOUD|FIREBASE|AWS|AZURE|CI_JOB)_/;
const forbiddenPaths = [
  "/var/run/docker.sock",
  "/root/.config/gcloud",
  "/root/.firebase",
  "/home/runner/.config/gcloud",
  "/home/runner/.firebase",
  "/github/home",
  "/github/workspace",
];

function check(name, condition) {
  if (!condition) throw new Error(`ISOLATION_CHECK_FAILED:${name}`);
  console.log(`ISOLATION_CHECK_PASS:${name}`);
}

function connectMustFail(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`ISOLATION_CHECK_FAILED:external_timeout:${host}:${port}`));
    }, 2_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error(`ISOLATION_CHECK_FAILED:external_connected:${host}:${port}`));
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function runChild(port) {
  const program = [
    "const net=require('node:net');",
    `const local=net.createConnection({host:'127.0.0.1',port:${port}});`,
    "local.once('connect',()=>{local.destroy();const remote=net.createConnection({host:'1.1.1.1',port:443});const t=setTimeout(()=>{remote.destroy();process.exit(3)},2000);remote.once('connect',()=>{clearTimeout(t);remote.destroy();process.exit(2)});remote.once('error',()=>{clearTimeout(t);process.exit(0)})});",
    "local.once('error',()=>process.exit(1));",
  ].join("");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--eval", program], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`ISOLATION_CHECK_FAILED:child_network_exit:${code}`)));
  });
}

async function main() {
  const forbiddenKeys = Object.keys(process.env).filter((key) => forbiddenEnvironment.test(key));
  check("no_credential_environment", forbiddenKeys.length === 0);
  check("no_sensitive_paths", forbiddenPaths.every((path) => !existsSync(path)));
  check("loopback_only", readdirSync("/sys/class/net").length === 1 && readdirSync("/sys/class/net")[0] === "lo");
  check("no_sensitive_mounts", !readFileSync("/proc/mounts", "utf8").match(/(?:gcloud|firebase|docker\.sock|github\/home|github\/workspace)/i));

  await connectMustFail("1.1.1.1", 443);
  check("internet_blocked", true);
  await connectMustFail("142.250.72.14", 443);
  check("google_cloud_blocked", true);
  await connectMustFail("169.254.169.254", 80);
  check("metadata_blocked", true);

  const server = http.createServer((request, response) => response.end("ok"));
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await runChild(address.port);
    check("child_inherits_network_isolation", true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  console.log("ISOLATION_PROOF_PASS");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
