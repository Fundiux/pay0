// Local-only receipt overlay: exact LIVE ZIP, TypeScript module, NEW private output.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');assert.equal(process.argv.slice(2).length,3,'THREE_ARGUMENTS_REQUIRED');
const [baseZip,compiler,out]=process.argv.slice(2).map(x=>path.resolve(x));
assert(out.startsWith(path.join(repo,'.firebase/modular-release')+path.sep)&&!fs.existsSync(out),'NEW_PRIVATE_OUTPUT_REQUIRED');
for(let p=path.dirname(out);p!==repo;p=path.dirname(p)){assert(p.startsWith(repo+path.sep),'OUTPUT_SCOPE');if(fs.existsSync(p))assert(!fs.lstatSync(p).isSymbolicLink(),'OUTPUT_LINK')}
const sha=b=>createHash('sha256').update(b).digest('hex'),baseSha='6615bb840530acf6dc31f2f86e988210f5505d2d17a0b4c05850c0c0eb2eb713',patchSha='a77076522e8b0fe2f7e68117515a6b4dbee0b3e1ccb114198dbde4020fdb2f1a';
const patch=path.join(repo,'qa/patches/document-learning-overlay.patch');assert.equal(sha(fs.readFileSync(baseZip)),baseSha);assert.equal(sha(fs.readFileSync(patch)),patchSha);
const source=path.join(out,'source'),runtime=path.join(out,'runtime');fs.mkdirSync(source,{recursive:true});fs.mkdirSync(runtime);
const configCommit='4c3dcb90857ee3e7f22edd38f9d43bfe7b7abdc1';const git=(commit,file)=>execFileSync('git',['show',commit+':functions/'+file],{cwd:repo});
const modules={receiptPdfCallables:'8af329e8cd6cded58d817fc8813fba7f84138ac2',receiptLearning:'a43658bab18004eff45cf944d35a93ca59a90f81',receiptIdentification:'d630dc541498c360626908a213060c8ae0d936e5'};
for(const [name,commit]of Object.entries(modules)){const file=path.join(source,'src/modules/pagos',name+'.ts');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,git(commit,'src/modules/pagos/'+name+'.ts').toString('utf8').replace(/\r\n/g,'\n'))}
fs.writeFileSync(path.join(source,'tsconfig.json'),git(configCommit,'tsconfig.json'));
const JSZip=createRequire(path.join(repo,'functions/package.json'))('jszip'),before=await JSZip.loadAsync(fs.readFileSync(baseZip));
for(const [name,entry]of Object.entries(before.files)){assert(!/[\\:\x00]/.test(name)&&!name.split('/').includes('..')&&!path.isAbsolute(name),'ARCHIVE_PATH');if(entry.dir)continue;const file=path.join(runtime,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,await entry.async('nodebuffer'))}
for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(runtime,file),path.join(source,file));
const ts=createRequire(import.meta.url)(compiler),config=ts.readConfigFile(path.join(source,'tsconfig.json'),ts.sys.readFile),options={...ts.convertCompilerOptionsFromJson(config.config.compilerOptions,source).options,sourceMap:false};
for(const name of Object.keys(modules)){const file='src/modules/pagos/'+name+'.ts',emitted=ts.transpileModule(fs.readFileSync(path.join(source,file),'utf8'),{compilerOptions:options,fileName:file}).outputText;assert.equal(emitted.trim(),fs.readFileSync(path.join(runtime,'lib/modules/pagos',name+'.js'),'utf8').trim(),'LIVE_EMITTER_MISMATCH:'+name)}
execFileSync('git',['-c','core.autocrlf=false','apply','--directory='+path.relative(repo,source).split(path.sep).join('/'),patch],{cwd:repo,stdio:'pipe'});
const changes=[];for(const name of Object.keys(modules)){const input='src/modules/pagos/'+name+'.ts',output='lib/modules/pagos/'+name+'.js';const emitted=ts.transpileModule(fs.readFileSync(path.join(source,input),'utf8'),{compilerOptions:options,fileName:input});assert(!emitted.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error),'TRANSPILE_FAILED');fs.writeFileSync(path.join(runtime,output),emitted.outputText);changes.push(output)}
const archive=path.join(out,'receipt-learning.zip');execFileSync('python',['-c',`import pathlib,sys,zipfile,json
base,runtime,out,names=sys.argv[1:];names=set(json.loads(names))
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist():
  data=(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in names else before.read(entry.filename)
  after.writestr(entry,data)
`,baseZip,runtime,archive,JSON.stringify(changes)],{stdio:'pipe'});
const after=await JSZip.loadAsync(fs.readFileSync(archive));let preserved=0;
assert.deepEqual(Object.keys(after.files),Object.keys(before.files),'ARCHIVE_ENTRIES_CHANGED');for(const[name,entry]of Object.entries(before.files)){if(entry.dir)continue;const same=(await entry.async('nodebuffer')).equals(await after.file(name).async('nodebuffer'));assert.equal(same,!changes.includes(name),'UNEXPECTED_DELTA:'+name);if(same)preserved++}
const manifest={status:'LOCAL_CANDIDATE_UNTESTED',baseArchiveSha256:baseSha,archiveSha256:sha(fs.readFileSync(archive)),patchSha256:patchSha,sourceTree:null,baselineEmitters:modules,configCommit,changedEntries:changes,preservedEntries:preserved,entries:Object.keys(before.files).length,targets:['parsePagoReceiptPdf','correctPagoReceiptSemanticField'],productionWrites:0};fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
