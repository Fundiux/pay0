const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
// Execute the actual pure parser declarations; no Firebase, OCR or payment call.
const file='functions/src/modules/pagos/receiptPdfCallables.ts',source=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
const functions=ast.statements.filter(ts.isFunctionDeclaration).map(node=>node.getFullText(ast)).join('\n');
const out={};new Function('exports',ts.transpileModule(functions,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out);
const parse=date=>out.parseReceiptText(['Transferencia SPEI MXN','Ordenante: Cliente Demo','Beneficiario: Empresa Demo','Monto: $100.00','Referencia: DEMO1234',date].join('\n'));
for(const [label,expected] of [
 ['Fecha: 05/06/2026','2026-06-05'],
 ['Fecha: 2026-06-05','2026-06-05'],
 ['Fecha de operacion: 20-Oct-2026 10:25:46','2026-10-20'],
 ['Fecha de la transferencia\n5 de junio del 2026','2026-06-05'],
 ['Fecha operacion 05/06/2026','2026-06-05'],
 ['Fecha: October 20, 2026','2026-10-20'],
 ['Fecha: Oct 20, 2026','2026-10-20'],
 ['Fecha: 10/20/2026','2026-10-20'],
 ['MM/DD/YYYY\nFecha: 05/06/2026','2026-05-06'],
 ['2026-06-05','2026-06-05'],
 ['Fecha de captura: 2026-06-04\nFecha de operacion: 2026-06-05','2026-06-05'],
 ['Fecha de operacion: 2026-06-05\nFecha de pago: 05/06/2026','2026-06-05'],
]) test('resolves document date '+label.replaceAll('\n',' / '),()=>{const r=parse(label);assert.equal(r.date,expected);assert.equal(r.dateVerified,true);assert(!r.warnings.some(w=>w.includes('ambiguo')));});
for(const label of [
 'Fecha de operacion: 31/02/2026',
 'Fecha de operacion: pendiente\nFecha y hora de captura: 2026-06-05',
 'Fecha de operacion: 2026-06-05\nFecha de pago: 2026-06-06',
 '2026-06-05\n2026-06-06',
 'Fecha: 2026-06-05 y 2026-06-06',
 'MM/DD/YYYY DD/MM/YYYY\nFecha: 05/06/2026',
 'Fecha: 31/14/2026',
 'Fecha: 05/06/26',
 '',
]) test('keeps unresolved or contradictory date manual '+label.replaceAll('\n',' / '),()=>{assert.equal(parse(label).dateVerified,false);});
test('date resolution never confirms bank execution or changes amounts',()=>{const r=parse('Fecha: 05/06/2026');assert.equal(r.amount,100);assert.equal(r.executionConfirmed,false);assert.equal(r.amountVerified,true);});
