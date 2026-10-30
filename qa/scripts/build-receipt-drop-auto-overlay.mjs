// Local-only overlay. The pinned production entry shim and every unrelated byte survive.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
assert(process.argv.slice(2).length===8,'BASEZIP_BASESOURCE_COMPILER_PATCH_PATCHSHA_ORIGIN_OUTPUT_MODE_REQUIRED');
const [baseArg,sourceArg,compilerArg,patchArg,patchSha,originCommit,outArg,mode]=process.argv.slice(2);assert(['BASELINE_ONLY','BUILD'].includes(mode));assert(/^[a-f0-9]{64}$/.test(patchSha));assert(/^[a-f0-9]{40}$/.test(originCommit));
const [baseZip,baselineSource,compiler,patch,out]=[baseArg,sourceArg,compilerArg,patchArg,outArg].map(x=>path.resolve(x));
assert(out.startsWith(path.join(repo,'.firebase/modular-release')+path.sep)&&!fs.existsSync(out),'NEW_PRIVATE_OUTPUT_REQUIRED');
for(let p=path.dirname(out);p!==repo;p=path.dirname(p)){assert(p.startsWith(repo+path.sep));if(fs.existsSync(p))assert(!fs.lstatSync(p).isSymbolicLink(),'OUTPUT_LINK')}
const baseSha='78f7403fa7011069eafc1a99bd01c4388bc40e075d450d224e4c8a7dff79056b';assert.equal(sha(fs.readFileSync(baseZip)),baseSha);
if(mode==='BUILD'){assert(!/^0+$/.test(patchSha)&&!/^0+$/.test(originCommit),'FINAL_SOURCE_PINS_REQUIRED');assert.equal(sha(fs.readFileSync(patch)),patchSha);const headers=fs.readFileSync(patch,'utf8').match(/^diff --git .*$/gm)||[];assert.equal(headers.length,4,'EXACT_FOUR_SOURCE_PATCH_REQUIRED');for(const name of ['receiptIdentificationDomain','receiptIdentification','receiptPdfCallables','receiptOperationType'])assert(headers.some(h=>h==='diff --git a/src/modules/pagos/'+name+'.ts b/src/modules/pagos/'+name+'.ts'),'PATCH_SCOPE:'+name);}
const source=path.join(out,'source'),runtime=path.join(out,'runtime');fs.mkdirSync(path.join(source,'src/modules/pagos'),{recursive:true});fs.mkdirSync(runtime);
for(const name of ['receiptIdentificationDomain','receiptIdentification','receiptPdfCallables','receiptSemantics','receiptLearning'])fs.copyFileSync(path.join(baselineSource,'src/modules/pagos',name+'.ts'),path.join(source,'src/modules/pagos',name+'.ts'));
fs.copyFileSync(path.join(baselineSource,'tsconfig.json'),path.join(source,'tsconfig.json'));
const JSZip=createRequire(path.join(repo,'functions/package.json'))('jszip'),before=await JSZip.loadAsync(fs.readFileSync(baseZip));
for(const[name,entry]of Object.entries(before.files)){assert(!/[\\:\x00]/.test(name)&&!name.split('/').includes('..')&&!path.isAbsolute(name),'ARCHIVE_PATH');if(entry.dir)continue;const f=path.join(runtime,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,await entry.async('nodebuffer'))}
for(const f of['package.json','package-lock.json'])fs.copyFileSync(path.join(runtime,f),path.join(source,f));
const ts=createRequire(import.meta.url)(compiler),config=ts.readConfigFile(path.join(source,'tsconfig.json'),ts.sys.readFile),options={...ts.convertCompilerOptionsFromJson(config.config.compilerOptions,source).options,sourceMap:false};
const names=['receiptIdentificationDomain','receiptIdentification','receiptPdfCallables'],sourcePins=[];
for(const name of names){const f='src/modules/pagos/'+name+'.ts';const bytes=fs.readFileSync(path.join(source,f));const emit=ts.transpileModule(bytes.toString('utf8'),{compilerOptions:options,fileName:f}).outputText;assert.equal(emit.trim(),fs.readFileSync(path.join(runtime,'lib/modules/pagos',name+'.js'),'utf8').trim(),'BASE_EMITTER_MISMATCH:'+name);sourcePins.push({file:f,beforeSha256:sha(bytes)})}
assert(!before.file('lib/modules/pagos/receiptOperationType.js'),'NEW_MODULE_ALREADY_EXISTS');assert(!fs.existsSync(path.join(source,'src/modules/pagos/receiptOperationType.ts')),'NEW_SOURCE_ALREADY_EXISTS');
const semanticBefore=fs.readFileSync(path.join(runtime,'lib/modules/pagos/receiptSemantics.js'));
const baselineProof={status:'PASS',baseArchiveSha256:baseSha,sourcePins,mode:'BASELINE_EMITTERS_ONLY',releaseEmitted:false};fs.writeFileSync(path.join(out,'baseline-emitter-proof.json'),JSON.stringify(baselineProof,null,2),{flag:'wx'});
if(mode==='BASELINE_ONLY'){console.log(JSON.stringify(baselineProof));process.exit(0)}
execFileSync('git',['-c','core.autocrlf=false','apply','--check','--directory='+path.relative(repo,source).split(path.sep).join('/'),patch],{cwd:repo,stdio:'pipe'});execFileSync('git',['-c','core.autocrlf=false','apply','--directory='+path.relative(repo,source).split(path.sep).join('/'),patch],{cwd:repo,stdio:'pipe'});
sourcePins.push({file:'src/modules/pagos/receiptOperationType.ts',beforeSha256:null});
const changes=[];for(const name of [...names,'receiptOperationType']){const f='src/modules/pagos/'+name+'.ts',output='lib/modules/pagos/'+name+'.js',bytes=fs.readFileSync(path.join(source,f));const emit=ts.transpileModule(bytes.toString('utf8'),{compilerOptions:options,fileName:f,reportDiagnostics:true});assert(!emit.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error),'TRANSPILE_ERROR');fs.writeFileSync(path.join(runtime,output),emit.outputText);changes.push(output);sourcePins.find(row=>row.file===f).afterSha256=sha(bytes)}
const archive=path.join(out,'receipt-drop-auto.zip');execFileSync('python',['-c',`import pathlib,sys,zipfile,json
base,runtime,out,names=sys.argv[1:];names=set(json.loads(names));added='lib/modules/pagos/receiptOperationType.js'
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist():
  after.writestr(entry,(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in names else before.read(entry.filename))
 entry=zipfile.ZipInfo(added,(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.create_system=3;entry.external_attr=0o100644<<16
 after.writestr(entry,(pathlib.Path(runtime)/added).read_bytes())
`,baseZip,runtime,archive,JSON.stringify(changes)]);
const after=await JSZip.loadAsync(fs.readFileSync(archive));const added=['lib/modules/pagos/receiptOperationType.js'];assert.deepEqual(Object.keys(after.files),[...Object.keys(before.files),...added],'ARCHIVE_ENTRY_ORDER_CHANGED');let preserved=0;
for(const[name,entry]of Object.entries(before.files)){if(entry.dir)continue;const same=(await entry.async('nodebuffer')).equals(await after.file(name).async('nodebuffer'));assert.equal(same,!changes.includes(name),'UNEXPECTED_DELTA:'+name);if(same)preserved++}
assert.deepEqual(fs.readFileSync(path.join(runtime,'lib/modules/pagos/receiptSemantics.js')),semanticBefore,'SEMANTICS_CHANGED');assert.equal(preserved,Object.values(before.files).filter(e=>!e.dir).length-3);assert.equal(Object.keys(after.files).length,Object.keys(before.files).length+1);assert.equal(changes.filter(x=>!added.includes(x)).length,3);
const manifest={status:'LOCAL_CANDIDATE_UNTESTED',sourceTree:null,originCommit,baseArchiveSha256:baseSha,archiveSha256:sha(fs.readFileSync(archive)),patchSha256:patchSha,sourcePins,changedEntries:changes.filter(x=>!added.includes(x)),addedEntries:added,preservedFiles:preserved,entries:Object.keys(after.files).length,files:Object.values(after.files).filter(e=>!e.dir).length,indexPreserved:true,baselineBundlePreserved:true,targets:['parsePagoReceiptPdf','correctPagoReceiptSemanticField'],productionWrites:0};fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));

