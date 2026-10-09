const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../../functions/node_modules/typescript');
const file = 'functions/src/modules/reports/pagoReportDateBackfillCallables.ts';
const source = fs.readFileSync(file, 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
class Timestamp { constructor(ms) {this.ms = ms;} static fromDate(date) {return new Timestamp(date.getTime());} toDate() {return new Date(this.ms);} }
class HttpsError extends Error {constructor(code, message) {super(message); this.code=code;}}
const rows = new Map(); let writes=0, transactions=0, beforeTransaction=()=>{};
function snapshot(id, value=rows.get(id)) {return {id, exists:!!value, ref:{id}, data:()=>value && {...value}};}
const db = {
 collection: name => {assert.equal(name,'pagos'); return {where(_field,_op,root) {return {orderBy() {let max=250,cursor='';const query={limit(n){max=n;return query;},startAfter(id){cursor=id;return query;},async get(){const docs=[...rows].filter(([id,row])=>row.rootId===root&&id>cursor).slice(0,max).map(([id,row])=>snapshot(id,{...row}));return{docs,size:docs.length};}};return query;}};}};},
 async runTransaction(fn) {transactions++;beforeTransaction();const pending=[];const count=await fn({get:async ref=>snapshot(ref.id),update:(ref,data)=>pending.push([ref.id,data])});for(const[id,data]of pending){rows.set(id,{...rows.get(id),...data});writes++;}return count;},
};
const exportsObject = {};
new Function('require','exports',compiled)(name=>{
 if(name==='firebase-admin')return{firestore:{Timestamp,FieldPath:{documentId:()=> '__name__'},FieldValue:{serverTimestamp:()=> 'SERVER'}}};
 if(name==='firebase-functions/v2/https')return{onCall:(_options,handler)=>handler,HttpsError};
 if(name.endsWith('/authGuard'))return{assertAuthorized:()=>{}};
 if(name.endsWith('/helpers'))return{db,requireAuth:()=> 'owner',getMyUser:async()=>({rootId:'root',role:'superadmin'}),requireRole:()=>{}};
 throw Error(name);
},exportsObject);
const run=data=>exportsObject.backfillPagoReportDates({auth:{uid:'owner'},data});
(async()=>{
 rows.set('a',{rootId:'root',fechaPago:new Timestamp(100)});
 assert.equal((await run({})).updated,0);assert.equal(writes,0);assert.equal(transactions,0);
 beforeTransaction=()=>rows.set('a',{...rows.get('a'),reportDateAt:new Timestamp(500),reportDateSource:'CANONICAL'});
 assert.equal((await run({apply:true})).updated,0);assert.equal(rows.get('a').reportDateAt.ms,500);assert.equal(writes,0);
 rows.set('b',{rootId:'root',fechaPago:new Timestamp(100)});
 beforeTransaction=()=>rows.set('b',{rootId:'other',fechaPago:new Timestamp(100)});
 assert.equal((await run({apply:true})).updated,0);assert.equal(rows.get('b').reportDateAt,undefined);
 rows.set('c',{rootId:'root',fechaPago:new Timestamp(100)});
 beforeTransaction=()=>rows.set('c',{rootId:'root',fechaPago:new Timestamp(900)});
 assert.equal((await run({apply:true})).updated,1);assert.equal(rows.get('c').reportDateAt.ms,900);assert.equal(writes,1);
 beforeTransaction=()=>{};assert.equal((await run({apply:true})).updated,0);assert.equal(writes,1);
 rows.set('d',{rootId:'root',fechaPago:new Timestamp(100)});beforeTransaction=()=>rows.delete('d');
 assert.equal((await run({apply:true})).updated,0);assert.equal(writes,1);
 console.log('PASS backfill: dry run, concurrent canonical date/root change/delete, current source date, replay no-op and accurate updated count');
})().catch(error=>{console.error(error);process.exitCode=1;});
