// Real React components + ExcelJS download; only callable/auth adapters use synthetic fixtures.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const esbuild = require('../../functions/node_modules/esbuild');
const { chromium, expect } = require('@playwright/test');
const ExcelJS = require('exceljs');
const workspaceRoot = path.resolve(__dirname, '../..');
const root = process.env.PAY0_HUGO_UI_ROOT ? path.resolve(process.env.PAY0_HUGO_UI_ROOT) : workspaceRoot;
const output = path.join(workspaceRoot, 'tmp/e1-hugo-report-download');
fs.mkdirSync(output, { recursive: true });
const row = { clienteId: '000123456789012345678', clienteNombre: 'Cliente autorizado', operationsCount: 7, grossAmount: 12345.67, baseAmount: 10001.2345, despachoCostAmount: 300.11, superadminEarningAmount: 234.56, adminEarningAmount: 78.9, operadorEarningAmount: 12.34, totalEarningsAmount: 325.8, clientChargeAmount: 450.12, clientNetAmount: 11895.55, lastCreatedAt: '2026-09-30T20:12:00.000Z' };
const format=process.env.PAY0_REPORT_TEST_FORMAT==='PDF'?'PDF':'XLSX',downloadLabel=`Descargar ${format}`;
const rows=format==='PDF'?[row,...Array.from({length:34},(_,i)=>({...row,clienteId:`long-${i}`,clienteNombre:`Cliente ${i} de nombre extenso con acentos: Operación y Administración Financiera ${'Sociedad de servicios profesionales '.repeat(3)}`}))]:[row];
const report = { version: 1, kind: 'EARNINGS_BY_CLIENT', ...(format==='PDF'?{format}:{}), fileName: `pay0-utilidades-2026-09-01-a-2026-09-30.${format.toLowerCase()}`, dateFrom: '2026-09-01', dateTo: '2026-09-30', includeCompensated: false, docsScanned: 5000, scanLimit: 5000, matchedClients: 251, exportedClients: rows.length, truncatedByScan: true, truncatedByExport: true, rows };
const mocks = {
  '@/lib/useUserProfile': `export const useUserProfile=()=>({profileUid:window.fixture.uid,profile:{rootId:window.fixture.rootId,role:'superadmin',active:true}});`,
  '@/lib/useModuleAccess': `export const useModuleAccess=()=>({canAccess:false});`,
  'next/navigation': `export const usePathname=()=>'/dashboard';`,
  '@/services/agent007': `export const listAgent007Messages=async()=>({messages:window.fixture.messages,voiceSessions:[],nextMessageCursor:null,nextVoiceCursor:null});export const listAgent007Recommendations=async()=>({recommendations:[]});export const markAgent007MessagesRead=async()=>({});export const getHugoDashboard=async()=>({attention:[],activity:[],consumption:{},providers:{},systems:[],capabilities:[]});export const getHugoVoiceSession=async()=>({turns:[],nextTurnCursor:null,nextEventCursor:null});export const resolveAgent007Recommendation=async()=>({});export const sendAgent007Message=()=>new Promise(resolve=>window.resolveFixtureSend=resolve);`,
};
async function build(kind) {
  const file = path.join(output, `${kind}.js`);
  const entry = kind === 'bubble' ? '@/components/HugoFloatingBubble' : '@/app/hugo/page';
  await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import Component from '${entry}';const root=createRoot(document.getElementById('root'));window.renderFixture=fixture=>{window.fixture=fixture;flushSync(()=>root.render(React.createElement(Component)));};`, loader:'tsx',resolveDir:root }, bundle:true,platform:'browser',format:'iife',outfile:file,jsx:'automatic',tsconfigRaw:{},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/.*/},args=>{
      if(mocks[args.path])return {path:args.path,namespace:'fixture'};
      if(/^@\/components\/(HugoComplementInventory|HugoTraceInspector|HugoMemoryDiagnostics|HugoLearningDiagnostics|HugoPhase7Review|hugo\/HugoRealtimeVoice)$/.test(args.path))return {path:args.path,namespace:'empty'};
      if(args.path.startsWith('@/')) {const base=path.join(root,'src',args.path.slice(2));return {path:fs.existsSync(base+'.tsx')?base+'.tsx':base+'.ts'};}
      if(args.path==='exceljs')return {path:require.resolve('exceljs/dist/exceljs.min.js')};
      if(args.path==='jspdf')return {path:require.resolve('jspdf/dist/jspdf.es.min.js')};
      if(args.path==='fflate')return {path:path.join(workspaceRoot,'node_modules/fflate/esm/browser.js')};
      if(args.path.startsWith('.')) {const file=path.resolve(args.resolveDir,args.path);for(const candidate of [file,file+'.tsx',file+'.ts',file+'.js',path.join(file,'index.js')])if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return {path:candidate};}
      if(!args.path.startsWith('.')&&!path.isAbsolute(args.path))return {path:require.resolve(args.path,{paths:[args.resolveDir||root,root,workspaceRoot]})};
    });
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx'}));
    b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'export default function Empty(){return null}',loader:'js'}));
  }}] });
  return file;
}
(async()=>{
  const browser = await chromium.launch({headless:true});
  try {
    for(const kind of ['bubble','page']) {
      const file=await build(kind),page=await browser.newPage({acceptDownloads:true});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('http://localhost/report-test',r=>r.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
      await page.goto('http://localhost/report-test');await page.addScriptTag({path:file});
      const mount=async(uid,rootId,messages)=>{await page.evaluate(f=>window.renderFixture(f),{uid,rootId,messages});if(kind==='bubble'){await page.getByRole('button',{name:/Abrir menú/}).click();await page.getByRole('menuitem',{name:'María',exact:true}).click();}};
      await mount('a','root-a',[{id:'promise',role:'assistant',text:'Prepararé el reporte.'}]);
      await expect(page.getByRole('button',{name:downloadLabel})).toHaveCount(0);
      await mount('b','root-b',[{id:'report',role:'assistant',text:'Reporte obtenido.',reportExport:report}]);
      await expect(page.getByRole('button',{name:downloadLabel})).toBeVisible();
      await expect(page.getByText(/Resultado parcial:/)).toBeVisible();
      await page.getByText('Ver importes del reporte',{exact:true}).click();
      await expect(page.getByRole('cell',{name:'10001.2345',exact:true}).first()).toBeVisible();
      const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:downloadLabel}).click();const download=await downloadPromise;
      assert.equal(download.suggestedFilename(),report.fileName);const target=path.join(output,`${kind}.${format.toLowerCase()}`);await download.saveAs(target);
      if(format==='PDF'){ const {execFileSync}=require('node:child_process');const pdf=JSON.parse(execFileSync('python',['-c','from pypdf import PdfReader; import json,sys; r=PdfReader(sys.argv[1]); print(json.dumps({"pages":len(r.pages),"pageTexts":[p.extract_text() for p in r.pages],"text":"\\n".join(p.extract_text() for p in r.pages)}))',target],{encoding:'utf8'}));assert(pdf.pages>1);for(const text of pdf.pageTexts)assert.equal(text.split('ID: ').length-1,text.split('12345.67').length-1,'Rows must remain intact across pages');for(const key of ['grossAmount','baseAmount','despachoCostAmount','superadminEarningAmount','adminEarningAmount','operadorEarningAmount','totalEarningsAmount','clientChargeAmount','clientNetAmount'])assert(pdf.text.includes(String(row[key])),key);assert(pdf.text.includes(row.clienteId));assert(pdf.text.includes('RESULTADO PARCIAL'));assert(pdf.text.includes('2026-09-01'));assert(pdf.text.includes('Cliente 33'));assert(pdf.text.includes(`P\u00e1gina ${pdf.pages} de ${pdf.pages}`));}else{
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(target);const sheet=workbook.getWorksheet('Ganancias cliente');
      const values={};sheet.getRow(1).eachCell((cell,col)=>values[cell.value]=sheet.getRow(2).getCell(col).value);
      assert.equal(values.ClienteId,row.clienteId);for(const [column,field]of Object.entries({Base:'baseAmount',Bruto:'grossAmount',CargoCliente:'clientChargeAmount',CostoDespacho:'despachoCostAmount',Superadmin:'superadminEarningAmount',Admin:'adminEarningAmount',Operador:'operadorEarningAmount',GananciaTotal:'totalEarningsAmount',NetoCliente:'clientNetAmount'}))assert.equal(values[column],row[field]);assert.equal(values.Desde,report.dateFrom);assert.equal(values.RevisionParcial,'Sí');assert.equal(values.ExportacionParcial,'Sí');
      }
      const canceledDownloads=[];const onDownload=d=>canceledDownloads.push(d);page.on('download',onDownload);
      await page.evaluate(label=>{[...document.querySelectorAll('button')].find(b=>b.textContent===label).click();window.renderFixture({uid:'cancel',rootId:'cancel-root',messages:[]});},downloadLabel);
      await page.waitForTimeout(500);assert.equal(canceledDownloads.length,0,'Changing user aborts a pending spreadsheet download');page.off('download',onDownload);
      await mount('b','root-c',[]);await expect(page.getByRole('button',{name:downloadLabel})).toHaveCount(0);await expect(page.getByText('Cliente autorizado',{exact:true})).toHaveCount(0);
      await page.locator('textarea').fill('Solicita reporte');await page.locator('textarea').press('Enter');
      await page.waitForFunction(()=>typeof window.resolveFixtureSend==='function');
      await mount('c','root-d',[]);await page.evaluate(payload=>window.resolveFixtureSend({profile:'OPERATOR',message:{id:'late',role:'assistant',text:'Antiguo',reportExport:payload}}),report);
      await expect(page.getByRole('button',{name:downloadLabel})).toHaveCount(0);
      await mount('d','root-e',[{id:'user-payload',role:'user',text:'No exportar',reportExport:report}]);await expect(page.getByRole('button',{name:downloadLabel})).toHaveCount(0);
      await mount('e','root-f',[{id:'invalid',role:'assistant',text:'Payload incompleto',reportExport:{...report,rows:[]}}]);await expect(page.getByRole('button',{name:downloadLabel})).toHaveCount(0);
      assert.deepEqual(errors,[]);await page.close();console.log(JSON.stringify({component:kind,result:'PASS',format,realDownload:true,exactPayloadAmounts:true,rootAndUserClearing:true,lateResponseDiscarded:true,pendingDownloadAborted:true}));
    }
  } finally {await browser.close();}
  const {execFileSync}=require('node:child_process'),crypto=require('node:crypto');
  const files=['src/services/agent007.ts','src/components/HugoFloatingBubble.tsx','src/app/hugo/page.tsx','src/components/hugo/HugoReportAttachment.tsx','src/lib/spreadsheetReader.ts'];if(fs.existsSync(path.join(root,'src/lib/hugoReportPdf.ts')))files.push('src/lib/hugoReportPdf.ts');
  fs.writeFileSync(path.join(output,'ui-source-proof.json'),JSON.stringify({status:'PASS',sourceRoot:root,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),components:['bubble','page'],format,realDownload:true,exactPayloadAmounts:true,contextClearing:true,productionWrites:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
