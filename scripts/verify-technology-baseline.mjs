import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// JSON.parse silently accepts duplicate keys. Scan the JSON grammar first,
// retaining a distinct key set per object (including escaped key spellings).
export function parseUniqueJson(text, label = 'JSON') {
  JSON.parse(text);
  let offset = 0;
  const whitespace = () => { while (/\s/.test(text[offset] || '') && offset < text.length) offset++; };
  const string = () => {
    const start = offset++;
    while (offset < text.length) {
      if (text[offset++] === '\\') offset++;
      else if (text[offset - 1] === '"') break;
    }
    return JSON.parse(text.slice(start, offset));
  };
  const value = () => {
    whitespace();
    if (text[offset] === '{') {
      offset++; whitespace();
      const keys = new Set();
      while (text[offset] !== '}') {
        const key = string();
        if (keys.has(key)) throw new Error(`${label}: duplicate key ${key}`);
        keys.add(key); whitespace(); offset++; value(); whitespace();
        if (text[offset] !== ',') break;
        offset++; whitespace();
      }
      offset++;
    } else if (text[offset] === '[') {
      offset++; whitespace();
      while (text[offset] !== ']') {
        value(); whitespace();
        if (text[offset] !== ',') break;
        offset++;
      }
      offset++;
    } else if (text[offset] === '"') string();
    else { while (offset < text.length && !/[\s,}\]]/.test(text[offset])) offset++; }
  };
  value();
  return JSON.parse(text);
}

export const components = ['.', 'functions', 'services/hugo-voice-gateway', 'services/hugo-voice-e2e', 'services/pay0-security-observation-publisher', 'services/pay0-sentinel-observation'];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

export function matchesDeclaredVersion(version, range) {
  const match = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const resolved = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || '');
  if (!match || !resolved) return false;
  const expected = match.slice(2).map(Number);
  const actual = resolved.slice(1).map(Number);
  const compare = actual[0] - expected[0] || actual[1] - expected[1] || actual[2] - expected[2];
  if (!match[1]) return compare === 0;
  if (compare < 0 || actual[0] !== expected[0]) return false;
  if (match[1] === '~' || expected[0] === 0) {
    if (actual[1] !== expected[1]) return false;
    if (match[1] === '^' && expected[1] === 0) return actual[2] === expected[2];
  }
  return true;
}

export function inspectTechnology(root, { nodeVersion = process.versions.node, installed = false } = {}) {
  const failures = [];
  const inventory = [];
  const read = relative => parseUniqueJson(fs.readFileSync(path.join(root, relative), 'utf8'), relative);
  const hashes = {};
  for (const component of components) {
    const manifestFile = path.posix.join(component, 'package.json');
    const lockFile = path.posix.join(component, 'package-lock.json');
    const manifest = read(manifestFile);
    const lock = read(lockFile);
    const lockedRoot = lock.packages?.[''];
    if (!lockedRoot || lock.lockfileVersion !== 3) failures.push(`${component}: lockfile v3 required`);
    if (manifest.engines?.node !== '22' || lockedRoot?.engines?.node !== '22') failures.push(`${component}: Node 22 required in manifest and lockfile`);
    if (manifest.name !== lockedRoot?.name || manifest.version !== lockedRoot?.version) failures.push(`${component}: manifest/lock identity mismatch`);
    if (manifest.overrides?.uuid) {
      const versions = Object.entries(lock.packages || {}).filter(([key]) => key.endsWith('node_modules/uuid'));
      if (!versions.length || versions.some(([, value]) => value.version !== manifest.overrides.uuid)) {
        failures.push(`${component}: uuid security override differs from resolved lock`);
      }
    }
    const dependencies = [];
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const declared = manifest[section] || {};
      const locked = lockedRoot?.[section] || {};
      if (JSON.stringify(Object.entries(declared).sort()) !== JSON.stringify(Object.entries(locked).sort())) failures.push(`${component}: ${section} manifest/lock mismatch`);
      for (const [name, range] of Object.entries(declared)) {
        const record = lock.packages?.[`node_modules/${name}`];
        if (!record?.version || !record.integrity) failures.push(`${component}: ${name} missing resolved version/integrity`);
        if (!matchesDeclaredVersion(record?.version, range)) failures.push(`${component}: ${name} resolved version outside declared range or unsupported spec`);
        let installedVersion = 'NOT_INSPECTED';
        if (installed) {
          const location = path.join(root, component, 'node_modules', name, 'package.json');
          installedVersion = fs.existsSync(location) ? parseUniqueJson(fs.readFileSync(location, 'utf8'), name).version : 'MISSING';
          if (installedVersion !== record?.version) failures.push(`${component}: installed ${name} differs from lock (${installedVersion} / ${record?.version})`);
        }
        dependencies.push({ name, declared: range, resolved: record?.version, installed: installedVersion });
      }
    }
    for (const file of [manifestFile, lockFile]) hashes[file] = hash(fs.readFileSync(path.join(root, file)));
    inventory.push({ component, node: manifest.engines?.node, dependencies });
  }
  const firebase = read('firebase.json');
  if (firebase.functions?.runtime !== 'nodejs22') failures.push('firebase.json: expected nodejs22');
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  if (!/node-version:\s*22\b/.test(ci)) failures.push('CI: expected Node 22');
  if (nodeVersion.split('.')[0] !== '22') failures.push(`running Node ${nodeVersion}, expected 22`);
  for (const file of ['firebase.json', 'config/release-baseline.json', '.github/workflows/ci.yml']) {
    hashes[file] = hash(fs.readFileSync(path.join(root, file)));
  }
  read('config/release-baseline.json');
  // The staging safety server intentionally has no dependencies/lockfile.
  const stagingFile = 'services/iq-staging-canary/package.json';
  const staging = read(stagingFile);
  if (staging.engines?.node !== '>=22 <23' || Object.keys(staging.dependencies || {}).length || Object.keys(staging.devDependencies || {}).length) {
    failures.push('iq-staging-canary: expected dependency-free Node 22 server; dependency additions require lockfile coverage');
  }
  hashes[stagingFile] = hash(fs.readFileSync(path.join(root, stagingFile)));
  inventory.push({ component: 'services/iq-staging-canary', node: staging.engines?.node, dependencies: [], lockfile: 'NOT_APPLICABLE_DEPENDENCY_FREE' });
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : 'UNKNOWN';
  };
  return {
    schemaVersion: 1, scope: 'local-source-technology', generatedAt: new Date().toISOString(),
    commit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
    sourceState: git(['status', '--porcelain']) === '' ? 'CLEAN' : 'DIRTY_OR_UNKNOWN',
    runtime: { node: nodeVersion, npm: process.env.npm_config_user_agent || 'UNKNOWN' },
    inventory, hashes, dependencyHash: hash(JSON.stringify(hashes)), failures,
    status: failures.length ? 'FAILED' : 'LOCAL_CONTRACT_PASSED',
    production: { deploymentId: 'UNKNOWN', runtime: 'UNKNOWN', artifactHash: 'UNKNOWN', previousRecoverableVersion: 'UNKNOWN' },
    certification: 'NOT_CERTIFIED', publication: 'NOT_PERFORMED', productionVerification: 'NOT_PERFORMED',
    vulnerabilityReview: 'NOT_PERFORMED_OFFLINE', supportReview: 'NOT_PERFORMED_OFFLINE',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = inspectTechnology(process.cwd(), { installed: process.argv.includes('--installed') });
    console.log(JSON.stringify(report, null, 2));
    if (report.failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
