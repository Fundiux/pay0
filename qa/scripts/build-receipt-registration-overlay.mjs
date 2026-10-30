// Local-only overlay. The pinned production entry shim and every unrelated byte survive.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(process.argv.slice(2).length,3,'BASE_COMPILER_NEW_OUTPUT_REQUIRED');const[baseZip,compiler,out]=process.argv.slice(2).map(x=>path.resolve(x));
assert(out.startsWith(path.join(repo,'.firebase/modular-release')+path.sep)&&!fs.existsSync(out),'NEW_PRIVATE_OUTPUT_REQUIRED');
for(let p=path.dirname(out);p!==repo;p=path.dirname(p)){assert(p.startsWith(repo+path.sep));if(fs.existsSync(p))assert(!fs.lstatSync(p).isSymbolicLink(),'OUTPUT_LINK')}
const baseSha='f88b88d75f8b99737d7b0b72364eb2a7fc4cbb9784175d4750cbf71f3876513f';assert.equal(sha(fs.readFileSync(baseZip)),baseSha);
const oldPatch=path.join(repo,'qa/patches/document-learning-overlay.patch');assert.equal(sha(fs.readFileSync(oldPatch)),'26aa99e2e947c6576766d7130f9fa26e048233f3cb9fbecc37752c99b4bd1559');
const patch=path.join(repo,'qa/patches/receipt-registration-overlay.patch');const patchSha=sha(fs.readFileSync(patch));assert.equal(patchSha,'d40b6930a212ba9237ea965bdd3db5a75f77f9af443ec37da1bc957ab3be73e7');
const source=path.join(out,'source'),runtime=path.join(out,'runtime');fs.mkdirSync(source,{recursive:true});fs.mkdirSync(runtime);
const git=(commit,file)=>execFileSync('git',['show',commit+':functions/'+file],{cwd:repo}).toString('utf8').replace(/\r\n/g,'\n');
const seeds={receiptPdfCallables:'8af329e8cd6cded58d817fc8813fba7f84138ac2',receiptLearning:'a43658bab18004eff45cf944d35a93ca59a90f81',receiptIdentification:'d630dc541498c360626908a213060c8ae0d936e5'};
for(const[name,commit]of Object.entries(seeds)){const f=path.join(source,'src/modules/pagos',name+'.ts');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,git(commit,'src/modules/pagos/'+name+'.ts'))}
execFileSync('git',['-c','core.autocrlf=false','apply','--directory='+path.relative(repo,source).split(path.sep).join('/'),oldPatch],{cwd:repo,stdio:'pipe'});
for(const[name,commit]of Object.entries({receiptIdentificationDomain:'8af329e8cd6cded58d817fc8813fba7f84138ac2',receiptSemantics:'4c3dcb90857ee3e7f22edd38f9d43bfe7b7abdc1'}))fs.writeFileSync(path.join(source,'src/modules/pagos',name+'.ts'),git(commit,'src/modules/pagos/'+name+'.ts'));
fs.writeFileSync(path.join(source,'tsconfig.json'),git('4c3dcb90857ee3e7f22edd38f9d43bfe7b7abdc1','tsconfig.json'));
const JSZip=createRequire(path.join(repo,'functions/package.json'))('jszip'),before=await JSZip.loadAsync(fs.readFileSync(baseZip));
for(const[name,entry]of Object.entries(before.files)){assert(!/[\\:\x00]/.test(name)&&!name.split('/').includes('..')&&!path.isAbsolute(name),'ARCHIVE_PATH');if(entry.dir)continue;const f=path.join(runtime,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,await entry.async('nodebuffer'))}
for(const f of['package.json','package-lock.json'])fs.copyFileSync(path.join(runtime,f),path.join(source,f));
const ts=createRequire(import.meta.url)(compiler),config=ts.readConfigFile(path.join(source,'tsconfig.json'),ts.sys.readFile),options={...ts.convertCompilerOptionsFromJson(config.config.compilerOptions,source).options,sourceMap:false};
const names=['receiptIdentificationDomain','receiptPdfCallables','receiptSemantics'],sourcePins=[];
for(const name of names){const f='src/modules/pagos/'+name+'.ts';const bytes=fs.readFileSync(path.join(source,f));const emit=ts.transpileModule(bytes.toString('utf8'),{compilerOptions:options,fileName:f}).outputText;assert.equal(emit.trim(),fs.readFileSync(path.join(runtime,'lib/modules/pagos',name+'.js'),'utf8').trim(),'BASE_EMITTER_MISMATCH:'+name);sourcePins.push({file:f,beforeSha256:sha(bytes)})}
execFileSync('git',['-c','core.autocrlf=false','apply','--check','--directory='+path.relative(repo,source).split(path.sep).join('/'),patch],{cwd:repo,stdio:'pipe'});execFileSync('git',['-c','core.autocrlf=false','apply','--directory='+path.relative(repo,source).split(path.sep).join('/'),patch],{cwd:repo,stdio:'pipe'});
const changes=[];for(const name of names){const f='src/modules/pagos/'+name+'.ts',output='lib/modules/pagos/'+name+'.js',bytes=fs.readFileSync(path.join(source,f));const emit=ts.transpileModule(bytes.toString('utf8'),{compilerOptions:options,fileName:f,reportDiagnostics:true});assert(!emit.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error),'TRANSPILE_ERROR');fs.writeFileSync(path.join(runtime,output),emit.outputText);changes.push(output);sourcePins.find(row=>row.file===f).afterSha256=sha(bytes)}
const archive=path.join(out,'receipt-registration.zip');execFileSync('python',['-c',`import pathlib,sys,zipfile,json
base,runtime,out,names=sys.argv[1:];names=set(json.loads(names))
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist():
  after.writestr(entry,(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in names else before.read(entry.filename))
`,baseZip,runtime,archive,JSON.stringify(changes)]);
const after=await JSZip.loadAsync(fs.readFileSync(archive));assert.deepEqual(Object.keys(after.files).sort(),Object.keys(before.files).sort());let preserved=0;
for(const[name,entry]of Object.entries(before.files)){if(entry.dir)continue;const same=(await entry.async('nodebuffer')).equals(await after.file(name).async('nodebuffer'));assert.equal(same,!changes.includes(name),'UNEXPECTED_DELTA:'+name);if(same)preserved++}
const manifest={status:'LOCAL_CANDIDATE_UNTESTED',sourceTree:null,originCommit:'898ce34',baseArchiveSha256:baseSha,archiveSha256:sha(fs.readFileSync(archive)),patchSha256:patchSha,sourcePins,changedEntries:changes,addedEntries:[],preservedFiles:preserved,entries:Object.keys(after.files).length,indexPreserved:true,baselineBundlePreserved:true,targets:['parsePagoReceiptPdf','correctPagoReceiptSemanticField'],productionWrites:0};fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
