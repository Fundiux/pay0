// Read-only filesystem confinement check; does not execute packages or alter the tree.
const fs = require('node:fs');
const path = require('node:path');
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function inspectRuntimeRealpaths(directory, { maxEntries = 250000, filesystem = fs } = {}) {
  const requested = path.resolve(directory), issues = [], seen = new Set(), active = new Set();
  const io = filesystem;
  let root, entriesVerified = 0, linksVerified = 0, halted = false;
  const issue = (file, code) => issues.push({ path: path.relative(requested, file) || '.', code });
  try {
    if (io.lstatSync(requested).isSymbolicLink()) throw Object.assign(Error(), { code: 'ROOT_LINK' });
    root = io.realpathSync(requested);
    if (!io.statSync(root).isDirectory()) throw Object.assign(Error(), { code: 'NOT_DIRECTORY' });
  } catch (error) { issue(requested, error.code || 'ROOT_UNREADABLE'); return { status: 'FAIL', entriesVerified, linksVerified, issues }; }
  function walk(directory) {
    if (halted) return;
    const physical = io.realpathSync(directory);
    if (!within(root, physical)) { issue(directory, 'LINK_ESCAPES_RUNTIME'); return; }
    if (active.has(physical)) { issue(directory, 'DIRECTORY_CYCLE'); return; }
    if (seen.has(physical)) return;
    active.add(physical); seen.add(physical);
    try {
      for (const entry of io.readdirSync(physical, { withFileTypes: true })) {
        if (halted) return;
        if (++entriesVerified > maxEntries) { issue(physical, 'ENTRY_LIMIT'); halted = true; return; }
        const file = path.join(physical, entry.name);
        try {
          const stat = io.lstatSync(file);
          if (stat.isSymbolicLink()) {
            const target = io.realpathSync(file);
            if (!within(root, target)) { issue(file, 'LINK_ESCAPES_RUNTIME'); continue; }
            linksVerified++;
            if (io.statSync(file).isDirectory()) walk(target);
          } else if (stat.isDirectory()) walk(file);
        } catch (error) { issue(file, error.code === 'ELOOP' ? 'LINK_CYCLE' : 'ENTRY_UNREADABLE'); }
      }
    } finally { active.delete(physical); }
  }
  try { walk(root); } catch (error) { issue(root, error.code === 'ELOOP' ? 'LINK_CYCLE' : 'TREE_UNREADABLE'); }
  return { schemaVersion: 1, status: issues.length ? 'FAIL' : 'PASS', root, entriesVerified, linksVerified,
    directoriesVerified: seen.size, issues, checkedAt: new Date().toISOString(),
    limitations: ['Snapshot only; concurrent filesystem mutation is not prevented.', 'Hard links are not classified as symbolic links.', 'No dependency or vulnerability certification.'] };
}
function assertRuntimeRealpaths(directory, options) {
  const result = inspectRuntimeRealpaths(directory, options);
  if (result.status !== 'PASS') throw Object.assign(Error('RUNTIME_PATHS_NOT_CONFINED'), { result });
  return result;
}
module.exports = { within, inspectRuntimeRealpaths, assertRuntimeRealpaths };
if (require.main === module) {
  try {
    const [directory, flag, output] = process.argv.slice(2);
    if (!directory || flag && (flag !== '--output' || !output)) throw Error('Use <runtime> [--output <file>]');
    const result = inspectRuntimeRealpaths(directory);
    if (output) {
      if (within(path.resolve(directory), path.resolve(output))) throw Error('OUTPUT_MUST_BE_OUTSIDE_RUNTIME');
      fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result)); process.exitCode = result.status === 'PASS' ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
