import { existsSync, readdirSync } from "node:fs";
import net from "node:net";
const deny = /^(GITHUB|ACTIONS|GOOGLE|GCLOUD|FIREBASE|AWS|AZURE)_/;
const fail = (name) => { throw new Error(`PRECHECK_FAILED:${name}`); };
if (Object.keys(process.env).some((key) => deny.test(key))) fail("credential_environment");
if (["/var/run/docker.sock","/root/.config/gcloud","/github/home","/github/workspace"].some(existsSync)) fail("sensitive_mount");
if (readdirSync("/sys/class/net").join(",") !== "lo") fail("external_interface");
async function blocked(host, port) { await new Promise((resolve, reject) => { const socket = net.createConnection({host,port}); const timer=setTimeout(()=>{socket.destroy();reject(new Error(`PRECHECK_FAILED:timeout:${host}`));},2000); socket.once("connect",()=>{clearTimeout(timer);socket.destroy();reject(new Error(`PRECHECK_FAILED:connected:${host}`));}); socket.once("error",()=>{clearTimeout(timer);resolve();}); }); }
await blocked("1.1.1.1",443); await blocked("142.250.72.14",443); await blocked("169.254.169.254",80);
console.log("EMULATOR_ISOLATION_PREFLIGHT_PASS");
