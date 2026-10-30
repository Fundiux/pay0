const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const MAX_MANIFEST_BYTES = 1024 * 1024;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const refuse = () => { throw Error('FACTORY_MANIFEST_INVALID'); };
function readManifestStdin(expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || '')) refuse();
  const parts=[]; let size=0; const buffer=Buffer.alloc(8192);
  for (;;) { const n=fs.readSync(0,buffer,0,buffer.length,null); if(!n)break; size+=n;if(size>MAX_MANIFEST_BYTES)refuse();parts.push(Buffer.from(buffer.subarray(0,n))); }
  const raw=Buffer.concat(parts);if(digest(raw)!==expected)refuse();
  let manifest;try{manifest=JSON.parse(raw.toString('utf8'));}catch{refuse();}
  return {manifest, manifestDigest:expected};
}
function validateManifest(code, manifest, expected) {
  if(!manifest || digest(JSON.stringify(manifest))!==expected || manifest.schema!=='FACTORY-MAP@1' || manifest.bundleSha256!==digest(Buffer.from(code)) || Object.keys(manifest).sort().join(',')!=='bundleSha256,entries,schema' || !Array.isArray(manifest.entries) || manifest.entries.length<200 || manifest.entries.length>5000 || Buffer.byteLength(JSON.stringify(manifest))>MAX_MANIFEST_BYTES)refuse();
  const keys=new Set(),ids=new Set();let previous=-1;
  for(const e of manifest.entries){
    if(!e || Object.keys(e).sort().join(',')!=='end,header,identifier,key,start' || typeof e.key!=='string' || !/^[A-Za-z0-9_./-]+$/.test(e.key) || e.key.startsWith('/') || e.key.split('/').some(x=>!x||x==='..'||x==='.') || ['__proto__','constructor','prototype'].includes(e.key) || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(e.identifier) || ['constructor','__proto__','prototype'].includes(e.identifier) || keys.has(e.key)||ids.has(e.identifier)||!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.end)||e.start<=previous||e.end<=e.start||e.end>code.length||e.end-e.start>2048||code.slice(e.start,e.end)!==e.header)refuse();
    const match=/^var ([A-Za-z_$][A-Za-z0-9_$]*) = __commonJS\(\{\s*("[A-Za-z0-9_./-]+")\(([A-Za-z_$][A-Za-z0-9_$]*(?:,\s*[A-Za-z_$][A-Za-z0-9_$]*)*)?\) \{$/.exec(e.header);
    if(!match||match[1]!==e.identifier||JSON.parse(match[2])!==e.key||(e.start>0&&code[e.start-1]!=='\n'))refuse();
    keys.add(e.key);ids.add(e.identifier);previous=e.end-1;
  }
  return manifest.entries;
}
function assertNoTypeScriptLoaded(){if(Object.keys(require.cache).some(k=>/[\\/]typescript[\\/]/.test(k)))throw Error('MEASUREMENT_TYPESCRIPT_LOADED');}
function prepareManifest(artifact) {
  const code=fs.readFileSync(path.resolve(artifact,'lib/index.js'),'utf8');
  if(digest(Buffer.from(code))!==bundleHash(artifact))throw Error('BUNDLE_HASH_MISMATCH');
  const ts=require('typescript');
  const ast=ts.createSourceFile('index.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),entries=[];
  for(const statement of ast.statements){
    if(!ts.isVariableStatement(statement))continue;
    for(const declaration of statement.declarationList.declarations){
      const call=declaration.initializer;
      if(!ts.isIdentifier(declaration.name)||!call||!ts.isCallExpression(call)||!ts.isIdentifier(call.expression)||call.expression.text!=='__commonJS')continue;
      const object=call.arguments[0],method=object?.properties?.[0];
      if(!object||!ts.isObjectLiteralExpression(object)||object.properties.length!==1||!ts.isMethodDeclaration(method)||!ts.isStringLiteral(method.name)||!method.body)refuse();
      const start=statement.getStart(ast),end=method.body.getStart(ast)+1;
      entries.push({key:method.name.text,identifier:declaration.name.text,start,end,header:code.slice(start,end)});
    }
  }
  const manifest={schema:'FACTORY-MAP@1',bundleSha256:digest(Buffer.from(code)),entries};
  const manifestDigest=digest(JSON.stringify(manifest));validateManifest(code,manifest,manifestDigest);return{manifest,manifestDigest};
}

function bundleHash(artifact) {
  const installed=path.resolve(artifact,'.bundle-provenance.json');
  const isInstalled=fs.existsSync(installed);
  const report=JSON.parse(fs.readFileSync(isInstalled?installed:path.resolve(artifact,'../provenance.json'),'utf8'));
  if(report.schema!==(isInstalled?'PAY0-INTERNAL-BUNDLE-INSTALLED@1':'PAY0-INTERNAL-BUNDLE-CANDIDATE@1'))throw Error('BUNDLE_PROVENANCE_SCHEMA');
  return report.outputs.find(row=>row.file===(isInstalled?'functions/lib/index.js':'lib/index.js'))?.sha256;
}

// Execute the exact candidate bytes. The in-memory suffix only exposes existing
// CommonJS factories to QA; it never changes their bodies or persists a hook.
function loadBundle({artifact, dependencyRoot, externalMocks = {}, manifest, manifestDigest, measured = false, fetch = async () => {throw Error('EXTERNAL_NETWORK_FORBIDDEN');}}) {
  const filename = path.resolve(artifact, 'lib/index.js');
  const bytes = fs.readFileSync(filename), code = bytes.toString('utf8');
  const expected = bundleHash(artifact);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!expected || actual !== expected) throw Error('BUNDLE_HASH_MISMATCH');
  if(measured){assertNoTypeScriptLoaded();if(!manifest||!manifestDigest)refuse();}
  const prepared=manifest?{manifest,manifestDigest}:prepareManifest(artifact);
  const entries=validateManifest(code,prepared.manifest,prepared.manifestDigest);
  const literal=entries.map(({key,identifier})=>`${JSON.stringify(key)}:${identifier}`).join(',');
  const suffix = `\n;return {api:module.exports, factories:{${literal}}};`;
  const nativeRequire = createRequire(path.resolve(dependencyRoot, 'package.json'));
  const requireExternal = name => {
    if (Object.hasOwn(externalMocks, name)) return externalMocks[name];
    if (name.startsWith('.') || path.isAbsolute(name)) throw Error('UNBUNDLED_INTERNAL_REQUIRE');
    return nativeRequire(name);
  };
  requireExternal.resolve = name => {
    if (name.startsWith('.') || path.isAbsolute(name)) throw Error('INTERNAL_REQUIRE_RESOLVE');
    return nativeRequire.resolve(name);
  };
  const module = {exports: {}};
  const execute = new Function('exports', 'require', 'module', '__filename', '__dirname', 'process', 'Buffer', 'fetch', code + suffix);
  const result = execute(module.exports, requireExternal, module, filename, path.dirname(filename), process, Buffer, fetch);
  if(measured)assertNoTypeScriptLoaded();
  return {
    api: result.api, sha256: actual,
    loadInternal(key) {
      if (!Object.hasOwn(result.factories,key)) throw Error('BUNDLE_MODULE_NOT_FOUND');
      const loader = result.factories[key];
      if (typeof loader !== 'function') throw Error('BUNDLE_MODULE_NOT_FOUND');
      return loader();
    },
  };
}
module.exports = {loadBundle,bundleHash,prepareManifest,validateManifest,readManifestStdin,assertNoTypeScriptLoaded};
