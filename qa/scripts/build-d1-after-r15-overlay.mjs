// Compose the unchanged complete D1 patch over the verified R1.5 report source.
// Args: verified R15 source, exact R15 ZIP, TypeScript module, NEW output directory.
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
replaceOnce('83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe', '45e8233d67051d3b61ec9b787474fcdd7dd020f3b391b421d25dfcf731fa9474');
replaceOnce('55c5c45aaab2a1603499a058605f4f38522e5092d2159957097566ac9b6dd077', '763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62');
replaceOnce('744e16e5f5166acd3fbeb5a60d674a59245f4287db7cf01d318a17856418e9ae', 'ecbcdb61ff78e31f1ff70c0130b36bc32722703faf2f7376d68de9883618dca3');
replaceOnce("'qa/patches/d1-after-r2-learning.patch'", "'qa/patches/d1-after-r14-revoke-off.patch'");
replaceOnce("'d1-after-r2.zip'", "'d1-after-r15.zip'");
// Binary patches preserve the source's original line endings; disable Git conversion.
assert.equal(recipe.split("execFileSync('git', ['apply',").length, 3, 'Expected two apply calls');
recipe = recipe.replaceAll("execFileSync('git', ['apply',", "execFileSync('git', ['-c', 'core.autocrlf=false', 'apply',");
fs.mkdirSync(path.dirname(args[3]), { recursive: true });
const driver = path.join(path.dirname(args[3]), `.d1-r14-composer-${randomUUID()}.mjs`);
fs.writeFileSync(driver, recipe, { flag: 'wx' });
try {
  execFileSync(process.execPath, [driver, ...args], { cwd: repo, stdio: 'inherit', windowsHide: true });
} finally {
  fs.unlinkSync(driver);
}
