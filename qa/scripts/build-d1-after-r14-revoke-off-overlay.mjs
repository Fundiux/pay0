// Reuse the audited composer with the complete D1 + gate-OFF revocation patch.
// Args: verified R14 source, exact R14 ZIP, TypeScript module, NEW output directory.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.length, 6, 'Expected baseSource baseZip typescriptModule newOutputDirectory');
const args = process.argv.slice(2).map(value => path.resolve(value));
assert(args[3].startsWith(repo + path.sep) && !fs.existsSync(args[3]), 'New workspace output directory required');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const oldRecipe = fs.readFileSync(path.join(repo, 'qa/scripts/build-d1-after-r2-overlay.mjs'), 'utf8');
assert.equal(sha(Buffer.from(oldRecipe)), '4ada3d5682a71a68cf5041b8b51743d27e164b5b228560c0daaefd7f6d465a6f', 'D1 recipe changed');
let recipe = oldRecipe;
function replaceOnce(before, after) {
  assert.equal(recipe.split(before).length, 2, `Expected one recipe anchor: ${before}`);
  recipe = recipe.replace(before, after);
}
replaceOnce("const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');", `const repo = ${JSON.stringify(repo)};`);
replaceOnce('83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe', '21922d596a664b2916fa459c5c51b165388db5a5b4af897995f3bb85d89b06f9');
replaceOnce('55c5c45aaab2a1603499a058605f4f38522e5092d2159957097566ac9b6dd077', 'c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d');
replaceOnce('744e16e5f5166acd3fbeb5a60d674a59245f4287db7cf01d318a17856418e9ae', 'd50be4740c312452675ac39870cf018a54e69298a85ec8b72ba007eeb7c4a1a7');
replaceOnce("'qa/patches/d1-after-r2-learning.patch'", "'qa/patches/d1-after-r14-revoke-off.patch'");
replaceOnce("'d1-after-r2.zip'", "'d1-after-r14-revoke-off.zip'");
fs.mkdirSync(path.dirname(args[3]), { recursive: true });
const driver = path.join(path.dirname(args[3]), `.d1-r14-composer-${randomUUID()}.mjs`);
fs.writeFileSync(driver, recipe, { flag: 'wx' });
try {
  execFileSync(process.execPath, [driver, ...args], { cwd: repo, stdio: 'inherit', windowsHide: true });
} finally {
  fs.unlinkSync(driver);
}
