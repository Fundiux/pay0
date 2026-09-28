const { spawnSync } = require('node:child_process');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw Error('LOCAL_EMULATOR_REQUIRED');
for (const file of [
  'materiality-payment-evidence-emulator.cjs',
  'payment-complement-gates-emulator-smoke.cjs',
  'payment-complement-automation-smoke.cjs',
]) {
  const child = spawnSync(process.execPath, [require('node:path').join(__dirname, file)], {stdio:'inherit',windowsHide:true});
  if (child.error || child.status !== 0) process.exit(child.status || 1);
}
