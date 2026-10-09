const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const file of ['username-auth-emulator.cjs', 'receipt-create-payment-emulator.cjs']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
