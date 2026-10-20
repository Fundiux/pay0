// Detaches the supervisor from an interactive shell; it records the child result on disk.
const { spawn } = require("node:child_process");
const path = require("node:path");
const spec = process.argv[2];
if (!spec) throw new Error("Uso: node persistent-test-launcher.cjs <spec.json>");
const child = spawn(process.execPath, [path.join(__dirname, "persistent-test-runner.cjs"), spec], { detached: true, windowsHide: true, stdio: "ignore" });
child.unref();
process.stdout.write(`${child.pid}\n`);
