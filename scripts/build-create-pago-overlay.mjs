// Build a single-endpoint overlay on the pinned production archive, never the checkout.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync, execFileSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'functions/package.json'));
const ts=require('typescript'),JSZip=require('jszip'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const [archiveArg,outputArg,mode]=process.argv.slice(2);assert(mode===undefined||mode==="--safe-recovery","INVALID_BUILD_MODE");assert(archiveArg&&outputArg,'BASE_ARCHIVE_AND_OUTPUT_REQUIRED');
const archive=path.resolve(archiveArg),output=path.resolve(outputArg),privateRoot=path.join(root,'.firebase/modular-release')+path.sep;
assert(archive.startsWith(privateRoot)&&output.startsWith(privateRoot),'PRIVATE_PATH_REQUIRED');
fs.mkdirSync(output,{recursive:true});
const bytes=fs.readFileSync(archive),zip=await JSZip.loadAsync(bytes),base=await zip.file('lib/index.js').async('string');
assert(!base.includes('const receiptLearning_1 ='),'UNEXPECTED_BASE_BINDING');
const config=ts.readConfigFile(path.join(root,'functions/tsconfig.json'),ts.sys.readFile);
const options=ts.convertCompilerOptionsFromJson(config.config.compilerOptions,path.join(root,'functions')).options;
const emitted=ts.transpileModule(fs.readFileSync(path.join(root,'functions/src/index.ts'),'utf8'),{compilerOptions:options}).outputText;
const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
function handler(source){const ast=ts.createSourceFile('index.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const matches=ast.statements.filter(n=>ts.isExpressionStatement(n)&&ts.isBinaryExpression(n.expression)&&n.expression.left.getText(ast)==='exports.createPago'&&ts.isCallExpression(n.expression.right));assert.equal(matches.length,1,'UNIQUE_CREATE_PAGO_REQUIRED');const node=matches[0].expression.right;return{node,start:node.getStart(ast),end:node.end,text:printer.printNode(ts.EmitHint.Expression,node,ast)};}
const before=handler(base),after=handler(emitted);
if(mode==='--safe-recovery'){const needle='const receiptIdentificationId = String(request.data?.receiptIdentificationId || "").trim();';const fallbackNeedle='const receiptIdentificationId = String(((_a = request.data) === null || _a === void 0 ? void 0 : _a.receiptIdentificationId) || "").trim();';const found=after.text.includes(needle)?needle:fallbackNeedle;assert(after.text.includes(found),'RECOVERY_GUARD_LOCATION');after.text=after.text.replace(found,found+'\n    if (receiptIdentificationId) throw new https_1.HttpsError("failed-precondition", "Registro desde comprobantes temporalmente pausado por recuperación segura.");');}
fs.writeFileSync(path.join(output,'callback-before.js'),before.text+'\n');fs.writeFileSync(path.join(output,'callback-after.js'),after.text+'\n');
const diff=spawnSync('git',['diff','--no-index','--',path.join(output,'callback-before.js'),path.join(output,'callback-after.js')],{encoding:'utf8',windowsHide:true});assert.equal(diff.status,1,'EXPECTED_CALLBACK_CHANGE');
assert(!diff.stdout.split('\n').some(line=>line.startsWith('-')&&!line.startsWith('---')),'NON_ADDITIVE_CALLBACK_CHANGE');
for(const invariant of ['receiptContentClaimRef','getReceiptActorCorrectionState','earlierIdentifications'])assert(after.text.includes(invariant),'MISSING_PAYMENT_GUARD');
const learningFile=path.join(root,'functions/src/modules/pagos/receiptLearning.ts'),learning=ts.createSourceFile(learningFile,fs.readFileSync(learningFile,'utf8'),ts.ScriptTarget.Latest,true);
const functions=learning.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getReceiptActorCorrectionState');assert.equal(functions.length,1);
const helper=ts.transpileModule(functions[0].getText(learning),{compilerOptions:options}).outputText;
assert(!helper.includes('require('),'CORRECTION_HELPER_MUST_BE_PURE');
const injection='const receiptLearning_1 = require("./createPagoReceiptCorrectionState");\nconst createPagoAuthority_1 = require("./modules/pagos/createPagoAuthority");\n';
let patched=base.slice(0,before.start)+after.text+base.slice(before.end);patched=patched.replace('"use strict";','"use strict";\n'+injection).replace(/^\/\/# sourceMappingURL=.*$/gm,'');
zip.file('lib/index.js',patched);zip.file('lib/createPagoReceiptCorrectionState.js',helper);
const authorityFiles=['modules/pagos/createPagoAuthority','modules/clientDelegations/access','modules/clientDelegations/policy'];
for(const name of authorityFiles){const source=fs.readFileSync(path.join(root,'functions/src',name+'.ts'),'utf8');const js=ts.transpileModule(source,{compilerOptions:{...options,sourceMap:false}}).outputText;zip.file('lib/'+name+'.js',js);}
const names=Object.keys(zip.files).filter(n=>!zip.files[n].dir);assert(!names.some(n=>/(^|\/)\.env(?:\.|$)/.test(n)),'ENV_IN_ARCHIVE');
for(const name of names){assert(!name.includes('..')&&!name.includes('\\')&&!name.startsWith('/')&&!name.includes(':'),'ZIP_PATH');zip.files[name].date=new Date('2026-01-01T00:00:00Z');}
const final=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}),finalPath=path.join(output,'functions.zip');fs.writeFileSync(finalPath,final,{flag:'wx'});
const original=await JSZip.loadAsync(bytes),updated=await JSZip.loadAsync(final);let preserved=0;for(const name of Object.keys(original.files).filter(n=>!original.files[n].dir&&n!=='lib/index.js'&&!['modules/pagos/createPagoAuthority','modules/clientDelegations/access','modules/clientDelegations/policy'].some(f=>n==='lib/'+f+'.js'))){assert.deepEqual(await original.file(name).async('nodebuffer'),await updated.file(name).async('nodebuffer'),'UNRELATED_ARTIFACT_CHANGED:'+name);preserved++;}
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const patchSha=sha(Buffer.from(JSON.stringify(Object.fromEntries(await Promise.all(['lib/index.js','lib/createPagoReceiptCorrectionState.js',...authorityFiles.map(f=>'lib/'+f+'.js')].map(async n=>[n,sha(await updated.file(n).async('nodebuffer'))]))))));
const manifest={status:'BUILT',sourceCommit:commit,sourceTree:null,archive:finalPath,archiveSha256:sha(final),baseArchiveSha256:sha(bytes),patchSha256:patchSha,changed:['lib/index.js','lib/modules/clientDelegations/access.js'],added:['lib/createPagoReceiptCorrectionState.js','lib/modules/pagos/createPagoAuthority.js','lib/modules/clientDelegations/policy.js'],preservedFiles:preserved,functions:['createPago'],callbackAdditionsOnly:true,packageAndLockUnchanged:true,configurationChanges:0,safeRecovery:mode==='--safe-recovery'};
fs.writeFileSync(path.join(output,'preservation.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(output,'callback.diff'),diff.stdout);console.log(JSON.stringify(manifest));
