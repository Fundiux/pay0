import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const dependencies = {
  access: [], documents: ['access'], pagos: ['access', 'documents'],
  engineering: ['access'], experience: [], platform: ['access'],
};
export function moduleFor(file) {
  if (/(?:rules$|authorization|roles\.|clientDelegations|modules\/users\/|RouteAccessGuard)/i.test(file)) return 'access';
  if (/(?:canonicalCenter|documentDossier|DocumentDossier|corporate-resources)/i.test(file)) return 'documents';
  if (/(?:pagos|pagoReceipt|receipt)/i.test(file)) return 'pagos';
  if (/(?:controlCenter|engineering|agent007)/i.test(file)) return 'engineering';
  if (/^src\/(?:components|app)\//.test(file)) return 'experience';
  return 'platform';
}
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`No se pudo inspeccionar Git: ${args[0]}`);
  return result.stdout.trim();
}
function files(cwd, args) { return git(cwd, args).split('\0').filter(Boolean); }
const runtime = file => /^(?:src\/|functions\/src\/|scripts\/|config\/|qa\/scripts\/|qa\/fixtures\/|(?:firestore|storage)\.rules$|(?:firebase|package|tsconfig)[^/]*\.json$)/.test(file);
export function inspectIntegration(cwd = process.cwd(), mainRef = 'main') {
  const candidateCommit = git(cwd, ['rev-parse', 'HEAD']);
  const sourceTree = git(cwd, ['rev-parse', 'HEAD^{tree}']);
  const mainCommit = git(cwd, ['rev-parse', '--verify', `${mainRef}^{commit}`]);
  const changed = files(cwd, ['diff', '--name-only', '-z', mainCommit, candidateCommit]).filter(runtime);
  const currentDirty = [...files(cwd, ['diff', 'HEAD', '--name-only', '-z']), ...files(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])].filter(runtime);
  const candidateFiles = new Set([...changed, ...currentDirty]);
  const blocks = git(cwd, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/);
  const unavailableWorktrees = [];
  const worktrees = blocks.map(block => {
    const lines = block.split(/\r?\n/);
    const location = lines.find(line => line.startsWith('worktree '))?.slice(9);
    if (!location || !fs.existsSync(location)) return null;
    const head = lines.find(line => line.startsWith('HEAD '))?.slice(5);
    if (!head) return null;
    const branch = lines.find(line => line.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') || '(detached)';
    try {
    const dirtyFiles = [...new Set([...files(location, ['diff', 'HEAD', '--name-only', '-z']), ...files(location, ['ls-files', '--others', '--exclude-standard', '-z'])].filter(runtime))].sort();
    const committedFiles = files(location, ['diff', '--name-only', '-z', mainCommit, head]).filter(runtime);
    const all = [...new Set([...dirtyFiles, ...committedFiles])].sort();
    const isCandidate = path.resolve(location).toLowerCase() === path.resolve(cwd).toLowerCase();
    // Hash only source paths selected above; never read environment or session files.
    const content = dirtyFiles.map(file => {
      const target = path.join(location, file);
      return [file, fs.existsSync(target) && fs.lstatSync(target).isFile()
        ? crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') : 'deleted-or-non-file'];
    });
    return { branch, head, isCandidate, dirty: dirtyFiles.length > 0,
      snapshotSha256: crypto.createHash('sha256').update(JSON.stringify({ head, content })).digest('hex'),
      modules: [...new Set(all.map(moduleFor))].sort(),
      overlapCount: isCandidate ? 0 : all.filter(file => candidateFiles.has(file)).length,
      overlappingFiles: isCandidate ? [] : all.filter(file => candidateFiles.has(file)), dirtyFiles,
    };
    } catch {
      if (path.resolve(location).toLowerCase() === path.resolve(cwd).toLowerCase()) throw new Error('No se pudo inspeccionar el candidato actual.');
      unavailableWorktrees.push({ branch, head, reason: 'GIT_READ_FAILED' });
      return null;
    }
  }).filter(Boolean);
  return { schemaVersion: 1, candidateCommit, sourceTree, mainCommit, status: 'candidate-only',
    capturedAt: new Date().toISOString(),
    modules: [...new Set([...candidateFiles].map(moduleFor))].sort().map(id => ({
      id, changedFiles: [...candidateFiles].filter(file => moduleFor(file) === id).length, dependencies: dependencies[id],
    })), worktrees, unavailableWorktrees,
    publication: 'NOT_ATTESTED',
    limitations: ['Solapes de rutas requieren revisión; no equivalen a conflictos.', 'Las ramas y referencias son locales; no se ha consultado el remoto.', 'No integra ni modifica otros worktrees.'],
  };
}
export function integrationSummary(report) {
  return { candidateCommit: report.candidateCommit, sourceTree: report.sourceTree, status: report.status,
    modules: report.modules, unavailableWorktreeCount: report.unavailableWorktrees.length,
    worktrees: report.worktrees.map(({ branch, head, dirty, modules, overlapCount }) => ({ branch, head, dirty, modules, overlapCount })),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = inspectIntegration();
  const directory = path.resolve('output/integration');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'inventory.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ candidateCommit: report.candidateCommit, worktrees: report.worktrees.length,
    dirtyWorktrees: report.worktrees.filter(row => row.dirty).length,
    overlappingWorktrees: report.worktrees.filter(row => row.overlapCount).length, output: 'output/integration/inventory.json' }));
}
