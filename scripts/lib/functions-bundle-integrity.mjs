import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function checkedPath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('PATH_SCOPE');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw Error('PATH_SCOPE');
  for (let current = target; current !== root; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('PATH_LINK'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
export function treeRows(root, relative) {
  const target = checkedPath(root, relative), stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw Error('PATH_LINK');
  if (stat.isFile()) return [{ file: relative, sha256: sha256(fs.readFileSync(target)) }];
  if (!stat.isDirectory()) throw Error('PATH_TYPE');
  return fs.readdirSync(target).sort().flatMap(name => treeRows(root, `${relative}/${name}`));
}
export function sourceSnapshot(root) {
  const paths = ['functions/src', 'functions/package.json', 'functions/package-lock.json', 'functions/tsconfig.json', 'src/canonicos/formatos', 'scripts/build-functions-internal-bundle.mjs', 'scripts/copy-canonical-assets.mjs', 'scripts/lib/functions-bundle-context.mjs', 'scripts/lib/functions-bundle-integrity.mjs'];
  return paths.flatMap(relative => treeRows(root, relative));
}
export function assertSnapshot(root, expected) {
  if (!Array.isArray(expected) || sha256(JSON.stringify(sourceSnapshot(root))) !== sha256(JSON.stringify(expected))) throw Error('SOURCE_DRIFT');
}
export function currentHash(file) {
  try { return sha256(fs.readFileSync(file)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
