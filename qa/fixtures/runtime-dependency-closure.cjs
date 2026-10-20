module.exports = [
  { name: 'complete-hoisted-transitive', expected: 'PASS', root: { dependencies: { a: '1.0.0' } }, packages: {
    a: { version: '1.0.0', dependencies: { b: '^1.0.0' } }, b: { version: '1.2.0' },
  } },
  { name: 'missing-direct', expected: 'FAIL', kind: 'MISSING', root: { dependencies: { a: '1.0.0' } }, packages: {} },
  { name: 'missing-transitive', expected: 'FAIL', kind: 'MISSING', root: { dependencies: { a: '1.0.0' } }, packages: {
    a: { version: '1.0.0', dependencies: { b: '^1.0.0' } },
  } },
  { name: 'incompatible-transitive-version', expected: 'FAIL', kind: 'INVALID', root: { dependencies: { a: '1.0.0' } }, packages: {
    a: { version: '1.0.0', dependencies: { b: '^1.0.0' } }, b: { version: '2.0.0' },
  } },
  { name: 'missing-optional', expected: 'PASS', root: { dependencies: { a: '1.0.0' } }, packages: {
    a: { version: '1.0.0', optionalDependencies: { b: '^1.0.0' } },
  } },
  { name: 'missing-required-peer', expected: 'FAIL', kind: 'MISSING', root: { dependencies: { a: '1.0.0' } }, packages: {
    a: { version: '1.0.0', peerDependencies: { b: '^1.0.0' } },
  } },
  { name: 'missing-optional-peer', expected: 'PASS', root: { dependencies: { a: '1.0.0' } }, packages: {
    a: { version: '1.0.0', peerDependencies: { b: '^1.0.0' }, peerDependenciesMeta: { b: { optional: true } } },
  } },
  { name: 'unused-extraneous', expected: 'PASS', kind: 'EXTRANEOUS', root: { dependencies: { a: '1.0.0' } }, packages: {
    a: { version: '1.0.0' }, unused: { version: '1.0.0' },
  } },
  { name: 'dev-dependency-omitted', expected: 'PASS', root: { devDependencies: { omitted: '1.0.0' } }, packages: {} },
];
