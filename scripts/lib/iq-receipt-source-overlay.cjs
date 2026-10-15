'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const ROOT=path.resolve(__dirname,'../..');
const PINS={zip:'c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f',parserExtractionProvenanceSha256:'2961685253d202125b34e1e0b6199b031302a2158204a59d92aeda3a9b151dbc',compiler:'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675',commit:'884e4b253210f0f938c2c41540d9d7993ce677a2',canonicalGuard:'26246a4c8841ea005993ffda182105cc8340e8b7a6637bfad6e671b2a2b188b7',reviewedReferenceSourceProvenanceSha256:'3a13834bd5dbd7b549c4c76abeb7300756a5197b842798a542fc08144b7fa489'};
const ENTRY='src/modules/paymentApplications/automaticApplication.ts',JS='lib/modules/paymentApplications/automaticApplication.js',MAP=JS+'.map',GUARD='src/modules/iq/historicalImportGuard.ts',GUARD_JS='lib/modules/iq/historicalImportGuard.js',GUARD_MAP=GUARD_JS+'.map',RECEIPT='applyPaymentAutomaticallyOnReceipt';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');function check(v,code){if(!v)throw Error(code)}

const archiveTools=(()=>{const assert=require('node:assert/strict');const LIMIT={compressed:16*1024*1024,entries:1084};
const CRC=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b){let n=0xffffffff;for(const v of b)n=CRC[(n^v)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
function directory(b){
 assert.ok(Buffer.isBuffer(b)&&b.length>=22&&b.length<=LIMIT.compressed,'ZIP_COMPRESSED_LIMIT');let end=-1;
 for(let p=b.length-22;p>=Math.max(0,b.length-65557);p--)if(b.readUInt32LE(p)===0x06054b50&&p+22+b.readUInt16LE(p+20)===b.length){end=p;break;}
 assert.ok(end>=0,'ZIP_EOCD');assert.equal(b.readUInt16LE(end+4),0);assert.equal(b.readUInt16LE(end+6),0);
 const count=b.readUInt16LE(end+10),start=b.readUInt32LE(end+16),size=b.readUInt32LE(end+12);assert.equal(count,b.readUInt16LE(end+8));assert.ok(count>0&&count<=LIMIT.entries);assert.equal(start+size,end,'ZIP_CENTRAL_RANGE');
 const bounds=(p,n,cap=end)=>assert.ok(Number.isSafeInteger(p)&&p>=0&&p+n<=cap,'ZIP_RANGE');
 function extras(p,n){const stop=p+n;while(p<stop){bounds(p,4,stop);const id=b.readUInt16LE(p),len=b.readUInt16LE(p+2);assert.ok(![1,0x7075,0x6375].includes(id),'ZIP_UNSUPPORTED_EXTRA');p+=4;bounds(p,len,stop);p+=len;}assert.equal(p,stop);}
 let pos=start;const rows=[],names=new Set(),ranges=[];
 for(let i=0;i<count;i++){
  bounds(pos,46);assert.equal(b.readUInt32LE(pos),0x02014b50);const flags=b.readUInt16LE(pos+8),method=b.readUInt16LE(pos+10),crc=b.readUInt32LE(pos+16),compressed=b.readUInt32LE(pos+20),expanded=b.readUInt32LE(pos+24),nl=b.readUInt16LE(pos+28),el=b.readUInt16LE(pos+30),cl=b.readUInt16LE(pos+32),local=b.readUInt32LE(pos+42);
  assert.equal(flags&~0x80e,0,'ZIP_FLAGS');assert.ok([0,8].includes(method),'ZIP_METHOD');assert.equal(b.readUInt16LE(pos+34),0,'ZIP_MULTIDISK');assert.ok(compressed!==0xffffffff&&expanded!==0xffffffff&&local!==0xffffffff,'ZIP64_UNSUPPORTED');bounds(pos+46,nl+el+cl);extras(pos+46+nl,el);
  const name=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(pos+46,pos+46+nl));assert.ok(name&&!/[\\:\x00-\x1f\x7f]/.test(name)&&!name.startsWith('/'),'ZIP_PATH');const components=name.replace(/\/$/,'').split('/');assert.ok(components.every(x=>x&&x!=='.'&&x!=='..'),'ZIP_PATH');assert.ok(!names.has(name),'ZIP_DUPLICATE');names.add(name);
  const type=(b.readUInt32LE(pos+38)>>>16)&0xf000;assert.ok([0,0x8000,0x4000].includes(type),'ZIP_FILE_TYPE');const isDirectory=name.endsWith('/');if(type===0x4000)assert.ok(isDirectory,'ZIP_TYPE_NAME');if(isDirectory)assert.equal(expanded,0,'ZIP_DIRECTORY');
  bounds(local,30,start);assert.equal(b.readUInt32LE(local),0x04034b50);assert.equal(b.readUInt16LE(local+6),flags,'ZIP_LOCAL_FLAGS');assert.equal(b.readUInt16LE(local+8),method,'ZIP_LOCAL_METHOD');const lnl=b.readUInt16LE(local+26),lel=b.readUInt16LE(local+28),data=local+30+lnl+lel;bounds(local+30,lnl+lel,start);extras(local+30+lnl,lel);assert.ok(b.subarray(pos+46,pos+46+nl).equals(b.subarray(local+30,local+30+lnl)),'ZIP_LOCAL_NAME');bounds(data,compressed,start);
  let localEnd=data+compressed;
  if(flags&8){for(const[o,v]of [[14,crc],[18,compressed],[22,expanded]])assert.ok(b.readUInt32LE(local+o)===0||b.readUInt32LE(local+o)===v,'ZIP_LOCAL_DESCRIPTOR');bounds(localEnd,12,start);let d=localEnd;if(b.readUInt32LE(d)===0x08074b50){d+=4;bounds(d,12,start);}assert.equal(b.readUInt32LE(d),crc,'ZIP_DESCRIPTOR_CRC');assert.equal(b.readUInt32LE(d+4),compressed,'ZIP_DESCRIPTOR_SIZE');assert.equal(b.readUInt32LE(d+8),expanded,'ZIP_DESCRIPTOR_SIZE');localEnd=d+12;}
  else{assert.equal(b.readUInt32LE(local+14),crc,'ZIP_LOCAL_CRC');assert.equal(b.readUInt32LE(local+18),compressed,'ZIP_LOCAL_SIZE');assert.equal(b.readUInt32LE(local+22),expanded,'ZIP_LOCAL_SIZE');}
  ranges.push([local,localEnd]);rows.push({name,method,crc,compressed,expanded,data,directory:isDirectory});pos+=46+nl+el+cl;
 }
 assert.equal(pos,end,'ZIP_CENTRAL_END');ranges.sort((a,c)=>a[0]-c[0]);for(let i=1;i<ranges.length;i++)assert.ok(ranges[i][0]>=ranges[i-1][1],'ZIP_OVERLAP');return rows;
}
return {directory,crc32};})();
const repackTools=(()=>{
// Pure byte transformation. No filesystem, archive module loading, or network.
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const LIMIT = Object.freeze({zip:16*1024*1024,entry:2*1024*1024,overlay:8*1024*1024,expanded:32*1024*1024});
const REPLACE = Object.freeze(['src/modules/paymentApplications/automaticApplication.ts','lib/modules/paymentApplications/automaticApplication.js','lib/modules/paymentApplications/automaticApplication.js.map']);
const ADD = Object.freeze(['src/modules/iq/historicalImportGuard.ts','lib/modules/iq/historicalImportGuard.js','lib/modules/iq/historicalImportGuard.js.map']);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function need(v,c){if(!v)throw Error(c);}
function layout(b,directory){
 need(Buffer.isBuffer(b)&&b.length<=LIMIT.zip,'ZIP_LIMIT');
 const checked=directory(b),end=b.length-22;
 need(end>=0&&b.readUInt32LE(end)===0x06054b50&&b.readUInt16LE(end+20)===0,'EOCD_PROFILE');
 const start=b.readUInt32LE(end+16);let p=start,cursor=0,expanded=0;const rows=[];
 for(const item of checked){
  const n=b.readUInt16LE(p+28),x=b.readUInt16LE(p+30),comment=b.readUInt16LE(p+32),local=b.readUInt32LE(p+42);
  need(x===0&&comment===0&&!item.directory&&item.method===8&&b.readUInt16LE(p+8)===8,'ENTRY_PROFILE');
  need(local===cursor&&b.readUInt16LE(local+28)===0,'LOCAL_PROFILE');
  const data=local+30+b.readUInt16LE(local+26),descriptor=data+item.compressed;
  need(data===item.data&&b.readUInt32LE(descriptor)===0x08074b50,'DESCRIPTOR_PROFILE');
  need(b.readUInt32LE(local+14)===0&&b.readUInt32LE(local+18)===0&&b.readUInt32LE(local+22)===0,'LOCAL_PLACEHOLDERS');
  cursor=descriptor+16;expanded+=item.expanded;
  need(expanded<=LIMIT.expanded&&cursor<=start,'EXPANDED_LIMIT');
  rows.push({...item,local,record:b.subarray(local,cursor),central:b.subarray(p,p+46+n),header:b.subarray(local,data)});
  p+=46+n;
 }
 need(cursor===start&&p===end,'CONTIGUOUS_PROFILE');return rows;
}
function overlayCheck(overlay,manifest){
 need(overlay instanceof Map&&overlay.size===6&&manifest.entries.length===6,'OVERLAY_COUNT');
 let total=0;const copy=new Map();
 for(const name of [...REPLACE,...ADD]){
  const bytes=overlay.get(name),entries=manifest.entries.filter(x=>x.name===name);
  need(Buffer.isBuffer(bytes)&&bytes.length<=LIMIT.entry&&entries.length===1,'OVERLAY_ENTRY');
  const m=entries[0];total+=bytes.length;
  need(m.operation===(REPLACE.includes(name)?'REPLACE':'ADD')&&m.bytes===bytes.length&&m.sha256===sha(bytes),'OVERLAY_PIN');
  copy.set(name,Buffer.from(bytes));
 }
 need(total<=LIMIT.overlay,'OVERLAY_LIMIT');return copy;
}
function centralOffset(record,offset){const b=Buffer.from(record);b.writeUInt32LE(offset,42);return b;}
function changed(name,bytes,template,crc32){
 const compressed=zlib.deflateRawSync(bytes,{level:9}),crc=crc32(bytes),filename=Buffer.from(name,'utf8');
 const h=Buffer.alloc(30+filename.length),c=Buffer.alloc(46+filename.length),d=Buffer.alloc(16);
 template.header.copy(h,0,0,30);h.writeUInt16LE(filename.length,26);h.writeUInt16LE(0,28);filename.copy(h,30);
 template.central.copy(c,0,0,46);c.writeUInt16LE(filename.length,28);c.writeUInt16LE(0,30);c.writeUInt16LE(0,32);filename.copy(c,46);
 c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(bytes.length,24);
 d.writeUInt32LE(0x08074b50,0);d.writeUInt32LE(crc,4);d.writeUInt32LE(compressed.length,8);d.writeUInt32LE(bytes.length,12);
 return {record:Buffer.concat([h,compressed,d]),central:c};
}
function repack(original,overlay,manifest,parser){
 const old=layout(original,parser.directory),bytes=overlayCheck(overlay,manifest);
 need(old.length===1081&&REPLACE.every(n=>old.some(r=>r.name===n))&&ADD.every(n=>!old.some(r=>r.name===n)),'ORIGINAL_SET');
 const locals=[],central=[];let offset=0;
 function append(row){need(offset+row.record.length<=LIMIT.zip,'OUTPUT_LIMIT');locals.push(row.record);central.push(centralOffset(row.central,offset));offset+=row.record.length;}
 for(const row of old)append(REPLACE.includes(row.name)?changed(row.name,bytes.get(row.name),row,parser.crc32):row);
 for(let i=0;i<ADD.length;i++)append(changed(ADD[i],bytes.get(ADD[i]),old.find(r=>r.name===REPLACE[i]),parser.crc32));
 const c=Buffer.concat(central),e=Buffer.from(original.subarray(original.length-22));
 need(offset+c.length+22<=LIMIT.zip,'OUTPUT_LIMIT');e.writeUInt16LE(1084,8);e.writeUInt16LE(1084,10);e.writeUInt32LE(c.length,12);e.writeUInt32LE(offset,16);
 const result=Buffer.concat([...locals,c,e]);verify(original,result,bytes,manifest,parser);return result;
}
function verify(original,result,overlay,manifest,parser){
 const old=layout(original,parser.directory),next=layout(result,parser.directory),bytes=overlayCheck(overlay,manifest);
 need(old.length===1081&&next.length===1084,'RESULT_COUNT');
 const names=[...old.map(r=>r.name),...ADD];need(next.every((r,i)=>r.name===names[i]),'RESULT_ORDER_SET');
 let retained=0,inflated=0;
 for(let i=0;i<old.length;i++)if(!REPLACE.includes(old[i].name)){
  need(old[i].record.equals(next[i].record),'RETAINED_LOCAL');
  need(centralOffset(old[i].central,0).equals(centralOffset(next[i].central,0)),'RETAINED_CENTRAL');retained++;
 }
 for(const name of [...REPLACE,...ADD]){
  const r=next.find(x=>x.name===name);need(r&&r.expanded<=LIMIT.entry,'CHANGED_LIMIT');
  const actual=zlib.inflateRawSync(result.subarray(r.data,r.data+r.compressed),{maxOutputLength:LIMIT.entry});inflated+=actual.length;
  need(inflated<=LIMIT.overlay&&actual.length===r.expanded&&parser.crc32(actual)===r.crc&&actual.equals(bytes.get(name)),'CHANGED_BYTES');
  const template=old.find(x=>x.name===(REPLACE.includes(name)?name:REPLACE[ADD.indexOf(name)]));
  const h=Buffer.from(r.header.subarray(0,26)),th=template.header.subarray(0,26);
  need(h.equals(th),'CHANGED_LOCAL_METADATA');
  const c=Buffer.from(r.central.subarray(0,46)),tc=Buffer.from(template.central.subarray(0,46));
  for(const b of [c,tc]){b.fill(0,16,28);b.fill(0,28,30);b.fill(0,42,46);}
  need(c.equals(tc),'CHANGED_CENTRAL_METADATA');
 }
 need(retained===1078,'RETAINED_COUNT');return {entries:1084,retained:1078,changed:6,changedInflatedBytes:inflated,archiveBytes:result.length,archiveSha256:sha(result),retainedUncompressedContentNotReverified:true};
}
return {LIMIT,REPLACE,ADD,layout,repack,verify,sha};

})();
function astTools(ts){const parse=text=>ts.createSourceFile(ENTRY,text,ts.ScriptTarget.Latest,true),printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed}),print=(node,sf)=>printer.printNode(ts.EmitHint.Unspecified,node,sf),name=(s,sf)=>ts.isVariableStatement(s)?s.declarationList.declarations[0]?.name.getText(sf):ts.isFunctionDeclaration(s)?s.name?.text:null;function receipt(sf){const found=sf.statements.filter(s=>name(s,sf)===RECEIPT);check(found.length===1,'RECEIPT_DECL');return found[0]}function guardIf(sf){const s=receipt(sf),decl=s.declarationList.declarations[0],call=decl.initializer;check(ts.isCallExpression(call)&&call.expression.getText(sf)==='onDocumentWritten'&&call.arguments.length===2&&ts.isArrowFunction(call.arguments[1]),'RECEIPT_CALLBACK');const found=call.arguments[1].body.statements.filter(s=>ts.isIfStatement(s)&&s.expression.getText(sf).startsWith('!pago ||'));check(found.length===1&&ts.isReturnStatement(found[0].thenStatement)&&!found[0].elseStatement,'RECEIPT_GUARD');return found[0]}return{parse,print,name,receipt,guardIf}}
function validateAstDelta(ts,original,patched,reference){const a=astTools(ts),old=a.parse(original),next=a.parse(patched),ref=a.parse(reference);check(old.parseDiagnostics.length===0&&next.parseDiagnostics.length===0&&ref.parseDiagnostics.length===0,'AST_PARSE');const imports=next.statements.filter(s=>ts.isImportDeclaration(s)&&s.moduleSpecifier.text==='../iq/historicalImportGuard');check(imports.length===1,'AST_IMPORT');const imp=imports[0],bindings=imp.importClause?.namedBindings;check(!imp.importClause?.isTypeOnly&&!imp.importClause?.name&&bindings&&ts.isNamedImports(bindings)&&bindings.elements.length===1&&bindings.elements[0].name.text==='isIqHistoricalImport'&&!bindings.elements[0].propertyName&&!bindings.elements[0].isTypeOnly,'AST_IMPORT_BINDING');const rest=next.statements.filter(s=>s!==imp);check(rest.length===old.statements.length,'AST_STATEMENT_COUNT');let preserved=0;for(let i=0;i<old.statements.length;i++){if(a.name(old.statements[i],old)===RECEIPT)continue;check(a.print(old.statements[i],old)===a.print(rest[i],next),'AST_OTHER_STATEMENT');if(old.statements[i].modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))preserved++}check(preserved===3,'AST_OTHER_EXPORTS');const originalIf=a.guardIf(old),nextIf=a.guardIf(next),referenceIf=a.guardIf(ref);check(originalIf.expression.getText(old)==='!pago || pago.rootId !== after.rootId','AST_ORIGINAL_GUARD');check(a.print(nextIf.expression,next)===a.print(referenceIf.expression,ref),'AST_REFERENCE_CONDITION');const reverted=patched.slice(0,nextIf.expression.getStart(next))+originalIf.expression.getText(old)+patched.slice(nextIf.expression.end),revertedSf=a.parse(reverted);check(a.print(a.receipt(revertedSf),revertedSf)===a.print(a.receipt(old),old),'AST_RECEIPT_OTHER_CHANGE');return {changedExports:[RECEIPT],preservedOtherExports:preserved,addedRuntimeImports:['isIqHistoricalImport'],referenceConditionExact:true,otherStatementsExact:true}}
function sourcePatch(original,patched){
 const old=original.split('\n'),next=patched.split('\n'),insert=next.indexOf('import { isIqHistoricalImport } from "../iq/historicalImportGuard";');
 check(insert>=0&&next.length===old.length+1,'PATCH_LINES');const at=old.findIndex(line=>line.includes('if (!pago || pago.rootId !== after.rootId)'));
 check(at>insert+6,'PATCH_CONDITION');const without=next.filter((_,i)=>i!==insert);for(let i=0;i<old.length;i++)check(i===at?without[i]===old[i].replace('!pago || pago.rootId !== after.rootId','!pago || isIqHistoricalImport(pago) || pago.rootId !== after.rootId'):without[i]===old[i],'PATCH_SCOPE');
 const a=insert-3,b=insert,c=at-3,d=at+4;check(a>=0&&d<old.length,'PATCH_CONTEXT');let out='--- a/'+ENTRY+'\n+++ b/'+ENTRY+'\n';
 out+='@@ -'+(a+1)+','+(b-a)+' +'+(a+1)+','+(b-a+1)+' @@\n';for(let i=a;i<b;i++)out+=' '+old[i]+'\n';out+='+'+next[insert]+'\n';
 out+='@@ -'+(c+1)+','+(d-c)+' +'+(c+2)+','+(d-c)+' @@\n';for(let i=c;i<d;i++)out+=i===at?'-'+old[i]+'\n+'+without[i]+'\n':' '+old[i]+'\n';return out;
}

const EXPECTED_ENTRIES=[{"name":"lib/modules/iq/historicalImportGuard.js","operation":"ADD","bytes":1022,"sha256":"9d9c5077c8c56228f48895d863da81f537fde00ba1dbc8866f30d0c60e6bb0bd","originalSha256":null},{"name":"lib/modules/iq/historicalImportGuard.js.map","operation":"ADD","bytes":914,"sha256":"e2588b71e701387426d2c8b5d0ac892047970f552eb64746d7d4e3d6a923a9d2","originalSha256":null},{"name":"lib/modules/paymentApplications/automaticApplication.js","operation":"REPLACE","bytes":8763,"sha256":"a982370bcf024c8f5e57c80c329bd9111a421156d9f0cb5295d4799a0cfa1789","originalSha256":"62b3c958178b18a88b24a5659e46e1cece59f7654ceeb5ae9946bf371895d865"},{"name":"lib/modules/paymentApplications/automaticApplication.js.map","operation":"REPLACE","bytes":7878,"sha256":"af22f5b778141fb420a148abbd9a65b5443fc3486719c9413fc3f772547432a3","originalSha256":"09d76e5e7ff208f0ed7fdf381c3f16153c213d327eb3c3a3c621737a26992f49"},{"name":"src/modules/iq/historicalImportGuard.ts","operation":"ADD","bytes":760,"sha256":"26246a4c8841ea005993ffda182105cc8340e8b7a6637bfad6e671b2a2b188b7","originalSha256":null},{"name":"src/modules/paymentApplications/automaticApplication.ts","operation":"REPLACE","bytes":7296,"sha256":"f0bc01a7fb5d1b0df641f5b6db7dc45b2b65694583cda23096b619b2419537f9","originalSha256":"085aed87fd30e302b79fe83e995f33c738a507f48612cf5f21359faa37e4c39e"}];
function buildOverlay({archivePath,compilerPath}={}){
 check(typeof archivePath==='string'&&typeof compilerPath==='string','EXPLICIT_INPUTS_REQUIRED');const ZIP=path.resolve(archivePath);
 check(fs.statSync(ZIP).isFile()&&fs.statSync(ZIP).size<=16*1024*1024,'ZIP_BOUND');const {directory,crc32}=archiveTools,archive=fs.readFileSync(ZIP);check(sha(archive)===PINS.zip,'ZIP_PIN');const rows=directory(archive);check(rows.length===1081,'ENTRY_COUNT');let inflated=0;const cache=new Map();function read(name){if(cache.has(name))return cache.get(name);const r=rows.find(x=>x.name===name);check(r&&!r.directory&&r.expanded<=2*1024*1024,'ENTRY_BOUND');const raw=archive.subarray(r.data,r.data+r.compressed),b=r.method===8?zlib.inflateRawSync(raw,{maxOutputLength:2*1024*1024}):Buffer.from(raw);inflated+=b.length;check(inflated<=32*1024*1024&&b.length===r.expanded&&crc32(b)===r.crc,'INFLATE_CHECK');const text=new TextDecoder('utf8',{fatal:true}).decode(b);cache.set(name,text);return text}
 const compiler=path.resolve(compilerPath);check(fs.statSync(compiler).isFile()&&fs.statSync(compiler).size<=12*1024*1024,'COMPILER_BOUND');check(sha(fs.readFileSync(compiler))===PINS.compiler,'COMPILER_PIN');const ts=require(compiler);check(ts.version==='5.9.3','COMPILER_VERSION');
 const virtual=path.join(__dirname,'virtual-functions').replaceAll('\\','/');check(!fs.existsSync(virtual),'VIRTUAL_ABSENT');const names=rows.filter(r=>!r.directory&&r.name.startsWith('src/')&&/\.tsx?$/.test(r.name)).map(r=>r.name),originalSources=new Map(names.map(n=>[virtual+'/'+n,read(n)])),config=JSON.parse(read('tsconfig.json'));check(!config.extends,'CONFIG_EXTENDS');const options=ts.convertCompilerOptionsFromJson(config.compilerOptions,virtual);check(options.errors.length===0,'CONFIG_OPTIONS');
 function emit(sources,entryNames,allowed){const host=ts.createCompilerHost(options.options),oldRead=host.readFile.bind(host),oldExists=host.fileExists.bind(host),norm=p=>path.resolve(p).replaceAll('\\','/');host.getCurrentDirectory=()=>virtual;host.readFile=file=>sources.get(norm(file))??oldRead(file);host.fileExists=file=>sources.has(norm(file))||oldExists(file);host.directoryExists=dir=>[...sources.keys()].some(f=>f.startsWith(norm(dir)+'/'))||ts.sys.directoryExists(dir);host.getDirectories=dir=>ts.sys.directoryExists(dir)?ts.sys.getDirectories(dir):[];const output=new Map();host.writeFile=(file,text)=>{const normalized=norm(file);check(normalized.startsWith(virtual+'/'),'EMIT_SCOPE');const rel=normalized.slice(virtual.length+1);check(allowed.includes(rel)&&!output.has(rel),'EMIT_FILES');output.set(rel,text)};const program=ts.createProgram([...sources.keys()],options.options,host);check(program.getCommonSourceDirectory()===virtual+'/src/','COMMON_SOURCE');for(const name of entryNames){const source=program.getSourceFile(virtual+'/'+name);check(source,'SOURCE_LOADED');const result=program.emit(source);check(!result.emitSkipped&&result.diagnostics.length===0,'EMIT_DIAGNOSTIC')}check(output.size===allowed.length,'EMIT_COUNT');return output}
 const original=emit(originalSources,[ENTRY],[JS,MAP]);check(Buffer.from(original.get(JS)).equals(Buffer.from(read(JS)))&&Buffer.from(original.get(MAP)).equals(Buffer.from(read(MAP))),'ORIGINAL_EMISSION');
 const canonical=fs.readFileSync(path.join(ROOT,'qa/fixtures/iq-receipt-hotfix/historicalImportGuard.ts'),'utf8').replace(/\r\n/g,'\n');check(sha(Buffer.from(canonical))===PINS.canonicalGuard,'CANONICAL_PIN');const source=read(ENTRY),a=astTools(ts),sf=a.parse(source),oldIf=a.guardIf(sf);const reference=source.slice(0,oldIf.expression.getStart(sf))+'!pago || isIqHistoricalImport(pago) || pago.rootId !== after.rootId'+source.slice(oldIf.expression.end),referenceSf=a.parse(reference),referenceIf=a.guardIf(referenceSf);check(!names.includes(GUARD)&&!rows.some(r=>[GUARD_JS,GUARD_MAP].includes(r.name)),'GUARD_ALREADY_PRESENT');const imports=sf.statements.filter(ts.isImportDeclaration),at=imports[imports.length-1].end;const condition=referenceIf.expression.getText(referenceSf);let patched=source.slice(0,oldIf.expression.getStart(sf))+condition+source.slice(oldIf.expression.end);const newline=source.includes('\r\n')?'\r\n':'\n';patched=patched.slice(0,at)+newline+'import { isIqHistoricalImport } from "../iq/historicalImportGuard";'+patched.slice(at);const astProof=validateAstDelta(ts,source,patched,reference);const patchText=fs.readFileSync(path.join(ROOT,'qa/fixtures/iq-receipt-hotfix/receipt-guard.patch'),'utf8').replace(/\r\n/g,'\n');check(sourcePatch(source,patched)===patchText,'PATCH_FIXTURE');
 const patchedSources=new Map(originalSources);patchedSources.set(virtual+'/'+ENTRY,patched);patchedSources.set(virtual+'/'+GUARD,canonical);const output=emit(patchedSources,[ENTRY,GUARD],[JS,MAP,GUARD_JS,GUARD_MAP]);const overlay=new Map([[ENTRY,patched],[GUARD,canonical],...output]);check(overlay.size===6,'OVERLAY_COUNT');const replacementNames=[ENTRY,JS,MAP],additionNames=[GUARD,GUARD_JS,GUARD_MAP];check([...overlay.keys()].every(n=>[...replacementNames,...additionNames].includes(n)),'OVERLAY_ALLOWLIST');const retained=rows.filter(r=>!replacementNames.includes(r.name)).map(r=>({name:r.name,compressedBytes:r.compressed,expandedBytes:r.expanded,crc:r.crc,compressedSha256:sha(archive.subarray(r.data,r.data+r.compressed))}));check(retained.length===1078,'RETAINED_COUNT');
 const manifest={schema:'PAY0-RECEIPT-GUARD-PORTABLE-OVERLAY@1',pins:PINS,compilerVersion:ts.version,originalEmissionExact:true,astProof,originalArchiveEntries:1081,resultingArchiveEntriesIfApplied:1084,retainedEntries:retained.length,retainedCompressedInventorySha256:sha(Buffer.from(JSON.stringify(retained))),retainedUncompressedContentNotReverified:true,entries:[...overlay].map(([name,text])=>({name,operation:replacementNames.includes(name)?'REPLACE':'ADD',bytes:Buffer.byteLength(text),sha256:sha(Buffer.from(text)),originalSha256:replacementNames.includes(name)?sha(Buffer.from(read(name))):null})).sort((a,b)=>a.name.localeCompare(b.name)),selectedInflatedBytes:inflated,compiledTestsExecuted:false,compiledCodeExecuted:false,sourceWorktreeWrites:0,repacked:false,networkCalls:0,typecheckCompleted:false};check(JSON.stringify(manifest.entries)===JSON.stringify(EXPECTED_ENTRIES),'OVERLAY_ENTRY_PINS');check(sha(fs.readFileSync(ZIP))===PINS.zip&&sha(fs.readFileSync(compiler))===PINS.compiler&&!fs.existsSync(virtual),'AFTER_PINS');return {overlayBytes:new Map([...overlay].map(([name,text])=>[name,Buffer.from(text)])),manifest,originalJs:original.get(JS),patchedJs:output.get(JS),guardJs:output.get(GUARD_JS),originalSource:source,patchedSource:patched,referenceSource:reference,ts};
}

module.exports={buildOverlay,validateAstDelta,PINS,archiveTools,repackTools,sourcePatch};
if(require.main===module){try{check(process.argv.length===6&&process.argv[2]==='--archive'&&process.argv[4]==='--compiler','ARGUMENTS');const result=buildOverlay({archivePath:process.argv[3],compilerPath:process.argv[5]});console.log(JSON.stringify(result.manifest));}catch{console.error('IQ_RECEIPT_OVERLAY_FAILED_REDACTED');process.exitCode=1;}}
