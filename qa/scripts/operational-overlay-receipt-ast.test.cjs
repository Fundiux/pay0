// Exercise the actual local recipe's receipt AST guard without assembling or networking.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../../functions/node_modules/typescript');
const recipe=fs.readFileSync(path.join(__dirname,'build-operational-dialogue-overlay.mjs'),'utf8');
const start=recipe.indexOf('function receiptParts('),end=recipe.indexOf('const changedEntries =',start);
assert(start>=0&&end>start);
const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
const ast=(file,text)=>printer.printFile(ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true));
const preserve=vm.runInNewContext(recipe.slice(start,end)+';preserveReceipt',{ts,assert,printer,ast});
const original=`const pagoView=(row:any)=>{
  const semanticReceipt = row.receiptLearningSignals?.semanticReceipt || null;
  return { id:row.id, comprobante:semanticReceipt?{
    readerVersion:row.receiptLearningSignals?.readerVersion || semanticReceipt.readerVersion || null,
    analysisId:row.receiptLearningSignals?.analysisId || null,
    reviewRequired:semanticReceipt.reviewRequired === true,
    reviewReasons:semanticReceipt.reviewReasons || [],
    fields:semanticReceipt.fields || {},
  }:null };
};`;
test('format and trailing comma changes preserve the exact committed source',()=>{
  const formatted=original.replace(/\n\s*/g,' ').replace('fields:semanticReceipt.fields || {},','fields:semanticReceipt.fields || {}');
  assert.equal(preserve('fixture.ts',original,formatted),formatted);
});
for(const [name,before,after] of [
  ['literal','analysisId || null','analysisId || "invented"'],
  ['operator','reviewRequired === true','reviewRequired !== true'],
  ['optional chain','receiptLearningSignals?.semanticReceipt','receiptLearningSignals.semanticReceipt'],
  ['field identifier','reviewReasons:','otherReasons:'],
  ['declaration kind','const semanticReceipt','let semanticReceipt'],
]) test('reject changed receipt '+name,()=>assert.throws(()=>preserve('fixture.ts',original,original.replace(before,after)),/COMMITTED_RECEIPT_/));
test('reject partial reconciliation instead of silently losing the receipt',()=>{
  assert.throws(()=>preserve('fixture.ts',original,original.replace('comprobante:','otherReceipt:')),/PARTIAL_RECEIPT_RECONCILIATION/);
});
