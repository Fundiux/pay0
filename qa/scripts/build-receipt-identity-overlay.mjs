// Local-only overlay. The pinned production entry shim and every unrelated byte survive.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
assert(process.argv.slice(2).length===8,'BASEZIP_BASESOURCE_COMPILER_PATCH_PATCHSHA_ORIGIN_OUTPUT_MODE_REQUIRED');
const [baseArg,sourceArg,compilerArg,patchArg,patchSha,originCommit,outArg,mode]=process.argv.slice(2);assert(['BASELINE_ONLY','BUILD'].includes(mode));assert(/^[a-f0-9]{64}$/.test(patchSha));assert(/^[a-f0-9]{40}$/.test(originCommit));
const [baseZip,baselineSource,compiler,patch,out]=[baseArg,sourceArg,compilerArg,patchArg,outArg].map(x=>path.resolve(x));
assert(out.startsWith(path.join(repo,'.firebase/modular-release')+path.sep)&&!fs.existsSync(out),'NEW_PRIVATE_OUTPUT_REQUIRED');
for(let p=path.dirname(out);p!==repo;p=path.dirname(p)){assert(p.startsWith(repo+path.sep));if(fs.existsSync(p))assert(!fs.lstatSync(p).isSymbolicLink(),'OUTPUT_LINK')}
const baseSha='6e0dffaa8af33582f09c7caa0f1a071f751cf1529e616f56e1dbd795c49224d0';assert.equal(sha(fs.readFileSync(baseZip)),baseSha);
if(mode==='BUILD'){assert(!/^0+$/.test(patchSha)&&!/^0+$/.test(originCommit),'FINAL_SOURCE_PINS_REQUIRED');assert.equal(sha(fs.readFileSync(patch)),patchSha);const headers=fs.readFileSync(patch,'utf8').match(/^diff --git .*$/gm)||[];assert.equal(headers.length,3,'EXACT_THREE_SOURCE_PATCH_REQUIRED');for(const name of ['receiptIdentificationDomain','receiptIdentification','receiptPdfCallables'])assert(headers.some(h=>h==='diff --git a/src/modules/pagos/'+name+'.ts b/src/modules/pagos/'+name+'.ts'),'PATCH_SCOPE:'+name);}
const source=path.join(out,'source'),runtime=path.join(out,'runtime');fs.mkdirSync(path.join(source,'src/modules/pagos'),{recursive:true});fs.mkdirSync(runtime);
for(const name of ['receiptIdentificationDomain','receiptIdentification','receiptPdfCallables','receiptSemantics','receiptLearning'])fs.copyFileSync(path.join(baselineSource,'src/modules/pagos',name+'.ts'),path.join(source,'src/modules/pagos',name+'.ts'));
fs.copyFileSync(path.join(baselineSource,'tsconfig.json'),path.join(source,'tsconfig.json'));
const JSZip=createRequire(path.join(repo,'functions/package.json'))('jszip'),before=await JSZip.loadAsync(fs.readFileSync(baseZip));
for(const[name,entry]of Object.entries(before.files)){assert(!/[\\:\x00]/.test(name)&&!name.split('/').includes('..')&&!path.isAbsolute(name),'ARCHIVE_PATH');if(entry.dir)continue;const f=path.join(runtime,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,await entry.async('nodebuffer'))}
for(const f of['package.json','package-lock.json'])fs.copyFileSync(path.join(runtime,f),path.join(source,f));
const ts=createRequire(import.meta.url)(compiler),config=ts.readConfigFile(path.join(source,'tsconfig.json'),ts.sys.readFile),options={...ts.convertCompilerOptionsFromJson(config.config.compilerOptions,source).options,sourceMap:false};
const names=['receiptIdentificationDomain','receiptIdentification','receiptPdfCallables'],sourcePins=[];
for(const name of names){const f='src/modules/pagos/'+name+'.ts';const bytes=fs.readFileSync(path.join(source,f));const emit=ts.transpileModule(bytes.toString('utf8'),{compilerOptions:options,fileName:f}).outputText;assert.equal(emit.trim(),fs.readFileSync(path.join(runtime,'lib/modules/pagos',name+'.js'),'utf8').trim(),'BASE_EMITTER_MISMATCH:'+name);sourcePins.push({file:f,beforeSha256:sha(bytes)})}
const semanticBefore=fs.readFileSync(path.join(runtime,'lib/modules/pagos/receiptSemantics.js'));
const baselineProof={status:'PASS',baseArchiveSha256:baseSha,sourcePins,mode:'BASELINE_EMITTERS_ONLY',releaseEmitted:false};fs.writeFileSync(path.join(out,'baseline-emitter-proof.json'),JSON.stringify(baselineProof,null,2),{flag:'wx'});
if(mode==='BASELINE_ONLY'){console.log(JSON.stringify(baselineProof));process.exit(0)}
execFileSync('git',['-c','core.autocrlf=false','apply','--check','--directory='+path.relative(repo,source).split(path.sep).join('/'),patch],{cwd:repo,stdio:'pipe'});execFileSync('git',['-c','core.autocrlf=false','apply','--directory='+path.relative(repo,source).split(path.sep).join('/'),patch],{cwd:repo,stdio:'pipe'});
const changes=[];for(const name of names){const f='src/modules/pagos/'+name+'.ts',output='lib/modules/pagos/'+name+'.js',bytes=fs.readFileSync(path.join(source,f));const emit=ts.transpileModule(bytes.toString('utf8'),{compilerOptions:options,fileName:f,reportDiagnostics:true});assert(!emit.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error),'TRANSPILE_ERROR');fs.writeFileSync(path.join(runtime,output),emit.outputText);changes.push(output);sourcePins.find(row=>row.file===f).afterSha256=sha(bytes)}
const archive=path.join(out,'receipt-identity.zip');execFileSync('python',['-c',`import pathlib,sys,zipfile,json
base,runtime,out,names=sys.argv[1:];names=set(json.loads(names))
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist():
  after.writestr(entry,(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in names else before.read(entry.filename))
`,baseZip,runtime,archive,JSON.stringify(changes)]);
const after=await JSZip.loadAsync(fs.readFileSync(archive));assert.deepEqual(Object.keys(after.files).sort(),Object.keys(before.files).sort());let preserved=0;
for(const[name,entry]of Object.entries(before.files)){if(entry.dir)continue;const same=(await entry.async('nodebuffer')).equals(await after.file(name).async('nodebuffer'));assert.equal(same,!changes.includes(name),'UNEXPECTED_DELTA:'+name);if(same)preserved++}
assert.deepEqual(fs.readFileSync(path.join(runtime,'lib/modules/pagos/receiptSemantics.js')),semanticBefore,'SEMANTICS_CHANGED');assert.equal(preserved,951);assert.equal(Object.keys(after.files).length,1176);
const manifest={status:'LOCAL_CANDIDATE_UNTESTED',sourceTree:null,originCommit,baseArchiveSha256:baseSha,archiveSha256:sha(fs.readFileSync(archive)),patchSha256:patchSha,sourcePins,changedEntries:changes,addedEntries:[],preservedFiles:preserved,entries:Object.keys(after.files).length,indexPreserved:true,baselineBundlePreserved:true,targets:['parsePagoReceiptPdf','correctPagoReceiptSemanticField'],productionWrites:0};fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));

