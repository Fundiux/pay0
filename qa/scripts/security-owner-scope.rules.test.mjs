import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const env = await initializeTestEnvironment({ projectId: 'demo-pay0-owner-scope', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
const seed = (p, d) => env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), p), d));
let checks = 0;
try {
 await env.clearFirestore();
 for (const role of ['superadmin', 'admin', 'operador']) {
  await seed('users/actor', { role, rootId: 'root', active: true });
  const db = env.authenticatedContext('actor').firestore();
  for (const family of ['clients', 'solicitudes', 'pagos', 'clientDispersions', 'clientBeneficiaries', 'clientBeneficiaryMethods', 'pagoAplicaciones']) {
   for (const rootId of ['root', 'foreign', null]) {
    await seed(`${family}/record`, { ...(rootId ? { rootId } : {}), adminId: 'actor', createdBy: 'actor', operadorId: 'actor' });
    const read = getDoc(doc(db, family, 'record'));
    await (rootId === 'root' ? assertSucceeds(read) : assertFails(read)); checks++;
   }
  }
 }
 console.log(JSON.stringify({ mode: 'FIRESTORE_DIRECT_OWNER_ROOT_SCOPE', checks, failures: 0, productionEffects: false }));
} finally { await env.cleanup(); }
