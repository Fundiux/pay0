'use strict';
// Synthetic ZIPs only; never loads the archived index or production modules.
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {repackTools:core,archiveTools:parser}=require('../../scripts/lib/iq-receipt-source-overlay.cjs');
function fixture(){
 const names=[...core.REPLACE,...Array.from({length:1078},(_,i)=>i===0?'.env.synthetic':`retained/${i}.txt`)];
 let offset=0;const local=[],central=[];
 for(const name of names){const raw=Buffer.from('synthetic:'+name),zip=zlib.deflateRawSync(raw),n=Buffer.from(name),h=Buffer.alloc(30+n.length),c=Buffer.alloc(46+n.length),d=Buffer.alloc(16),crc=parser.crc32(raw);
 h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(8,6);h.writeUInt16LE(8,8);h.writeUInt16LE(n.length,26);n.copy(h,30);
 c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,8);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(zip.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);n.copy(c,46);
 d.writeUInt32LE(0x08074b50);d.writeUInt32LE(crc,4);d.writeUInt32LE(zip.length,8);d.writeUInt32LE(raw.length,12);local.push(h,zip,d);central.push(c);offset+=h.length+zip.length+d.length;
 }
 const cd=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(1081,8);e.writeUInt16LE(1081,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(offset,16);
 const original=Buffer.concat([...local,cd,e]),overlay=new Map([...core.REPLACE,...core.ADD].map(n=>[n,Buffer.from('new:'+n)]));
 const manifest={entries:[...overlay].map(([name,b])=>({name,operation:core.REPLACE.includes(name)?'REPLACE':'ADD',bytes:b.length,sha256:core.sha(b)}))};return {original,overlay,manifest};
}
test('1084 exact entries, 1078 full raw records retained, six bounded inflates',()=>{const f=fixture(),b=core.repack(f.original,f.overlay,f.manifest,parser),v=core.verify(f.original,b,f.overlay,f.manifest,parser);assert.equal(v.retained,1078);assert.equal(v.entries,1084);assert.equal(v.changed,6);assert.equal(v.retainedUncompressedContentNotReverified,true);});
test('deterministic bytes and inputs unchanged',()=>{const f=fixture(),before=core.sha(f.original),one=core.repack(f.original,f.overlay,f.manifest,parser),two=core.repack(f.original,f.overlay,f.manifest,parser);assert.ok(one.equals(two));assert.equal(core.sha(f.original),before);});
test('reject missing overlay member',()=>{const f=fixture();f.overlay.delete(core.ADD[0]);assert.throws(()=>core.repack(f.original,f.overlay,f.manifest,parser),/OVERLAY_COUNT/);});
test('reject changed overlay hash',()=>{const f=fixture();f.overlay.set(core.ADD[0],Buffer.from('changed'));assert.throws(()=>core.repack(f.original,f.overlay,f.manifest,parser),/OVERLAY_PIN/);});
test('reject overlay entry bound before compression',()=>{const f=fixture();f.overlay.set(core.ADD[0],Buffer.alloc(core.LIMIT.entry+1));assert.throws(()=>core.repack(f.original,f.overlay,f.manifest,parser),/OVERLAY_ENTRY/);});
test('reject extra manifest entry',()=>{const f=fixture();f.manifest.entries.push({...f.manifest.entries[0]});assert.throws(()=>core.repack(f.original,f.overlay,f.manifest,parser),/OVERLAY_COUNT/);});
test('reject retained compressed payload mutation without inflating it',()=>{const f=fixture(),b=core.repack(f.original,f.overlay,f.manifest,parser),r=core.layout(b,parser.directory)[4];b[r.data]^=1;assert.throws(()=>core.verify(f.original,b,f.overlay,f.manifest,parser),/RETAINED_LOCAL/);});
test('reject retained timestamp mutation',()=>{const f=fixture(),b=core.repack(f.original,f.overlay,f.manifest,parser),r=core.layout(b,parser.directory)[4];b[r.local+10]^=1;assert.throws(()=>core.verify(f.original,b,f.overlay,f.manifest,parser),/RETAINED_LOCAL/);});
test('reject changed central metadata mutation',()=>{const f=fixture(),b=core.repack(f.original,f.overlay,f.manifest,parser),start=b.readUInt32LE(b.length-6);b[start+12]^=1;assert.throws(()=>core.verify(f.original,b,f.overlay,f.manifest,parser),/CHANGED_CENTRAL_METADATA/);});
test('reject trailing bytes',()=>{const f=fixture();assert.throws(()=>core.repack(Buffer.concat([f.original,Buffer.from([0])]),f.overlay,f.manifest,parser));});
test('reject ZIP bound',()=>{assert.throws(()=>core.layout(Buffer.alloc(core.LIMIT.zip+1),parser.directory),/ZIP_LIMIT/);});
test('reject wrong original count',()=>{const f=fixture(),b=Buffer.from(f.original);b.writeUInt16LE(1080,b.length-14);b.writeUInt16LE(1080,b.length-12);assert.throws(()=>core.repack(b,f.overlay,f.manifest,parser));});
