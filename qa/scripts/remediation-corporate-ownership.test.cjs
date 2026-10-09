const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const file = 'functions/src/modules/canonicalCenter/service.ts';
const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['isOwnCorporateCompany', 'companyFor'];
const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
assert.equal(nodes.length, names.length);
let row;
const db = {doc: path => { assert.equal(path, 'companies/company'); return {get: async () => ({data: () => row})}; }};
class HttpsError extends Error {constructor(code, message) {super(message); this.code = code;}}
const clean = (value, max = 180) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const code = ts.transpileModule(nodes.map(n => n.getText(ast)).join('\n'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const api = new Function('db', 'HttpsError', 'clean', `${code};return {${names.join(',')}};`)(db, HttpsError, clean);
async function run() {
  const ctx = {uid: 'owner', rootId: 'root'};
  for (const own of [{isOwnCompany: true}, {ownedByRoot: true}, {pay0OwnCompany: true}, {ownership: 'PROPIA'}, {companyOwnership: 'PROPIA'}, {companyType: 'PROPIA'}, {rfc: 'tro230717l64'}]) {
    row = {rootId: 'root', active: true, despachoId: 'non-fiscal-dispatch', ...own};
    assert.equal((await api.companyFor(ctx, 'company')).id, 'company');
    row = {...row, rootId: 'foreign-root'};
    await assert.rejects(api.companyFor(ctx, 'company'), e => e.code === 'permission-denied');
  }
  for (const unavailable of [undefined, {rootId: 'root', isOwnCompany: true, active: false},
    {rootId: 'root', despachoId: 'foreign-dispatch', ownership: 'EXTERNA', rfc: 'AAA010101AAA'},
    {rootId: 'root', despachoId: 'vjq4SEnucenerXvoLqtK', ownership: 'EXTERNA', rfc: 'AAA010101AAA'}]) {
    row = unavailable;
    await assert.rejects(api.companyFor(ctx, 'company'), e => e.code === 'permission-denied');
  }
  assert.equal(api.isOwnCorporateCompany({rfc: 'TRO 230717L64'}), false, 'Do not broaden legacy RFC normalization');
  console.log('PASS corporate ownership: 19 assertions; same legacy ownership, root isolation, foreign company denied regardless of dispatch');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
