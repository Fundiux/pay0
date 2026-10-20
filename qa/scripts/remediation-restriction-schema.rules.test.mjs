import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
assert.match(host, /^127\.0\.0\.1:\d+$/, 'Loopback emulator required');
const root = path.resolve(process.env.PAY0_RULES_SOURCE_ROOT || '.');
const source = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
const backend = fs.readFileSync('functions/src/modules/users/restrictions.ts', 'utf8');
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(backend, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const now = Date.now();
const base = { schemaVersion: 1, writer: 'PAY0_TRUSTED_RESTRICTION_WRITER@1', policyVersion: 'PAY0-CONTAINMENT@1', restrictionId: 'restriction', rootId: 'root', subjectUid: 'subject', state: 'ACTIVE', scope: 'ACCOUNT_OPERATIONS', authority: 'HUMAN_SECURITY_ADMIN', authorityUid: 'reviewer', reasonCode: 'SECURITY_REVIEW', incidentId: 'incident', issuedAtMs: now - 7200000, expiresAtMs: now - 3600000, authorizationVersion: 1 };
const revoked = { ...base, state: 'REVOKED', revokedAtMs: now - 1000, revokedBy: 'reviewer', revocationReason: 'REVIEW_CLEARED' };
const cases = [{}, { trustedRestrictionV1: base }, { trustedRestrictionV1: revoked }, { trustedRestrictionV1: { ...base, expiresAtMs: now + 100000 } }];
for (const row of [base, revoked]) {
  for (const key of Object.keys(row)) {
    const missing = { ...row }; delete missing[key]; cases.push({ trustedRestrictionV1: missing });
    for (const value of [null, false, 0, '', {}, [], 'invalid/value']) cases.push({ trustedRestrictionV1: { ...row, [key]: value } });
  }
  cases.push({ trustedRestrictionV1: { ...row, unknownField: true } });
}
for (const value of [null, false, 0, '', [], 'bad']) cases.push({ trustedRestrictionV1: value });
for (const key of ['restrictionId', 'authorityUid', 'incidentId', 'revokedBy']) {
  for (const value of ['a'.repeat(128), 'a'.repeat(129), 'subject', '0', 123]) cases.push({ trustedRestrictionV1: { ...revoked, [key]: value } });
}
for (const key of ['issuedAtMs', 'expiresAtMs', 'revokedAtMs', 'authorizationVersion']) {
  for (const value of [-1, 0.5, 253402300800000, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) cases.push({ trustedRestrictionV1: { ...revoked, [key]: value } });
}
for (const rootId of [null, false, 0, '', 'root', 'foreign', ' root ', 5]) cases.push({ rootId, trustedRestrictionV1: base });
const probe = `match /__schema/{id} { allow read: if restrictionAllowsUserForUid(resource.data, 'subject', restrictionRoot(resource.data, 'subject')); }`;
const env = await initializeTestEnvironment({ projectId: 'demo-pay0-restriction-schema', firestore: { host: '127.0.0.1', port: Number(host.split(':')[1]), rules: source.replace(/  }\n}\n?$/, `${probe}\n  }\n}\n`) } });
let allowed = 0;
try {
  await env.clearFirestore();
  for (const [index, patch] of cases.entries()) {
    const user = { rootId: 'root', ...patch };
    // Run the canonical pure evaluator in its realm so its plain-object guard applies.
    context.userJson = JSON.stringify(user); context.now = now;
    const expected = vm.runInContext("!exports.evaluateTrustedRestriction(JSON.parse(userJson), 'subject', now).restricted", context);
    await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), '__schema', String(index)), user));
    let actual = true;
    try { await getDoc(doc(env.authenticatedContext('subject').firestore(), '__schema', String(index))); }
    catch (error) { assert.doesNotMatch(String(error.message), /1000 expressions|maximum.*expression/i); assert.equal(error.code, 'permission-denied'); actual = false; }
    assert.equal(actual, expected, `Canonical restriction schema case ${index}: ${JSON.stringify(user)}`);
    if (actual) allowed++;
  }
  console.log(JSON.stringify({ mode: 'RESTRICTION_SCHEMA_PARITY', cases: cases.length, allowed, denied: cases.length - allowed, budgetErrors: 0 }));
} finally { await env.cleanup(); }
