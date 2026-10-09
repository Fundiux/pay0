const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const ts = require('../../functions/node_modules/typescript');
const file = 'functions/src/modules/assets/callables.ts';
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'seedUproAssetPortfolio') callback = node.initializer.arguments[1].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback);
const js = ts.transpileModule(`const callable = ${callback};`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const data = new Map();
let queue = Promise.resolve(), writes = 0, audits = 0, clock = 0;
const db = {
  doc: path => ({path, id: path.split('/').at(-1)}),
  runTransaction: operation => {
    // Serial commit models the successful retry order for conflicting seeds.
    const run = queue.then(async () => {
      const pending = [];
      const tx = {
        get: async ref => ({exists: data.has(ref.path), data: () => data.get(ref.path)}),
        create: (ref, value) => { pending.push([ref, value]); },
      };
      const result = await operation(tx);
      for (const [ref] of pending) assert.equal(data.has(ref.path), false, 'create cannot overwrite history');
      for (const [ref, value] of pending) { data.set(ref.path, value); writes++; }
      return result;
    });
    queue = run.catch(() => {});
    return run;
  },
};
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const seed = new Function('db', 'context', 'hash', 'FieldValue', 'logActivityTx', 'HttpsError', `${js}; return callable;`)(
  db, async request => ({uid: request.uid, rootId: 'root'}), hash,
  {serverTimestamp: () => ++clock},
  (tx, database, event) => tx.create(database.doc(`audit/${++audits}`), event), HttpsError);
(async () => {
  const results = await Promise.all([seed({uid: 'owner'}), seed({uid: 'owner'})]);
  assert.deepEqual(results.map(x => x.alreadySeeded), [false, true]);
  assert.equal(audits, 1);
  assert.equal([...data.keys()].filter(x => x.startsWith('assetPositions/')).length, 3);
  const position = `assetPositions/${hash('owner:UPRO_POSITION:KWID')}`;
  data.set(position, {...data.get(position), status: 'CLOSED', name: 'Edited after import', createdAt: 99});
  const before = JSON.stringify([...data]); const beforeWrites = writes;
  assert.equal((await seed({uid: 'owner'})).alreadySeeded, true);
  assert.equal(JSON.stringify([...data]), before); assert.equal(writes, beforeWrites); assert.equal(audits, 1);
  const partial = `assetPositions/${hash('partial:UPRO_POSITION:KWID')}`;
  data.set(partial, {status: 'CLOSED', name: 'Existing history'});
  await assert.rejects(seed({uid: 'partial'}), error => error.code === 'failed-precondition');
  assert.deepEqual(data.get(partial), {status: 'CLOSED', name: 'Existing history'});
  assert.equal(data.has(`assetSeeds/${hash('partial:UPRO_V1')}`), false);
  assert.equal(writes, beforeWrites); assert.equal(audits, 1);
  assert.equal((await seed({uid: 'other'})).alreadySeeded, false);
  assert.equal(audits, 2);
  assert.equal(ast.parseDiagnostics.length, 0);
  console.log('PASS seed: transactional create, concurrent replay no-op, edited/closed history preserved, partial data fails closed, separate owner supported');
})().catch(error => { console.error(error); process.exitCode = 1; });
