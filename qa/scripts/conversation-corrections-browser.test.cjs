const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const esbuild = require('../../functions/node_modules/esbuild');
const { chromium, expect } = require('@playwright/test');
const workspace = path.resolve(__dirname, '../..');
const root = process.env.PAY0_D2_UI_ROOT ? path.resolve(process.env.PAY0_D2_UI_ROOT) : workspace;
const output = process.env.PAY0_D2_UI_OUTPUT ? path.resolve(process.env.PAY0_D2_UI_OUTPUT) : path.join(workspace, 'tmp/conversation-corrections-browser');
assert.ok(root === workspace || root.startsWith(workspace + path.sep), 'UI source must be in the workspace');
assert.ok(output.startsWith(workspace + path.sep), 'QA output must be in the workspace');
fs.mkdirSync(output, { recursive: true });
const mocks = {
  '@/lib/useUserProfile': 'export const useUserProfile=()=>({profileUid:window.profile.uid,profile:{rootId:window.profile.rootId,role:window.profile.role,active:window.profile.active,disabled:window.profile.disabled}});',
  '@/lib/firebaseClient': 'export const functions={};',
  'firebase/functions': 'export const httpsCallable=(_,name)=>data=>window.callable(name,data);',
};
(async () => {
  await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import View,{HugoCorrectionTopic} from '@/components/hugo/HugoResponseCorrection';import {sendAgent007Message} from '@/services/agent007';window.sendCurrent=()=>sendAgent007Message('Explica el tema','GLOBAL',window.topic||undefined);const root=createRoot(document.getElementById('root'));window.renderProfile=profile=>{if(JSON.stringify(window.profile)!==JSON.stringify(profile))window.topic="";window.profile=profile;flushSync(()=>root.render(<><HugoCorrectionTopic value={window.topic||""} onChange={v=>{window.topic=v;window.renderProfile(window.profile)}}/><View message={window.message} scope={window.scope} onSaved={v=>window.saved=v} onTopicSelected={v=>{window.topic=v;window.renderProfile(window.profile)}}/></>));};`, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfigRaw: {}, define: { 'process.env.NODE_ENV': '"development"' }, outfile: path.join(output, 'fixture.js'), plugins: [{ name: 'transport-only', setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (mocks[args.path]) return { path: args.path, namespace: 'fixture' };
      if (args.path.startsWith('@/')) { const base = path.join(root, 'src', args.path.slice(2)); return { path: fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts' }; }
      if (args.path.startsWith('.')) {
        const file = path.resolve(args.resolveDir, args.path);
        for (const candidate of [file, file + '.tsx', file + '.ts', file + '.js', file + '.json', path.join(file, 'index.js')])
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { path: candidate };
      }
      if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) return { path: require.resolve(args.path, { paths: [args.resolveDir || root, root] }) };
    });
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
  } }] });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => {
      window.message={id:'real-answer',role:'assistant',text:'Respuesta inicial sint\u00e9tica'};window.scope='GLOBAL';window.calls=[];
      window.callable=async(name,input)=>{
        window.calls.push({name,input});if(name==='sendAgent007Message')return{data:{ok:true,message:{id:'next',role:'assistant',text:'Synthetic reply'}}};if(name==='reviewAgent007MemoryCandidate')return {data:{ok:true,changed:!window.noChange}};
        if(window.reject)throw Error('Correcci\u00f3n denegada');
        if(window.legacy)return {data:{ok:true,status:'CANDIDATE'}};
        const result={data:{ok:true,status:'CONFIRMED',correction:{memoryId:'memory-demo',version:input.responseCorrection.expectedVersion+1,content:input.content,status:'CONFIRMED',scope:input.responseCorrection.rememberFor?'USER_TOPIC':'CONVERSATION_ONLY',expiresAt:input.responseCorrection.rememberFor?null:new Date(Date.now()+1800000).toISOString(),...(input.responseCorrection.rememberFor?{topic:{kind:'TOPIC',id:'topic-demo',label:input.responseCorrection.rememberFor.label}}:{})}}};
        if(window.hold)return new Promise(resolve=>window.finish=()=>resolve(result));
        return result;
      };
    });
    await page.addScriptTag({path:path.join(output,'fixture.js')});
    const profile={uid:'actor-a',rootId:'root-a',role:'superadmin',active:true};
    await page.evaluate(p=>window.renderProfile(p),profile);
    const edit=async(text)=>{await page.getByRole('button',{name:/Corregir respuesta|Editar tu correcci/}).click();await page.getByRole('textbox',{name:'Respuesta corregida'}).fill(text);await page.getByRole('textbox',{name:'Tema del recuerdo'}).fill('Explicaciones operativas');};
    await edit('Una explicaci\u00f3n breve.');
    await expect(page.getByRole('button',{name:/^Guardar correcci/ })).toBeDisabled();
    await page.getByRole('checkbox').check();await page.getByRole('button',{name:/^Guardar correcci/ }).click();
    await expect(page.getByLabel('Tu respuesta corregida',{exact:true})).toContainText('Una explicaci\u00f3n breve.');
    assert.equal(await page.evaluate(()=>window.saved.content),'Una explicaci\u00f3n breve.');
    await expect(page.getByText('Explicaciones operativas',{exact:true})).toBeVisible();await page.evaluate(()=>window.sendCurrent());assert.equal(await page.evaluate(()=>window.calls.at(-1).input.correctionTopic),'Explicaciones operativas');
    const call=await page.evaluate(()=>window.calls[0]);assert.equal(call.name,'createAgent007MemoryCandidate');assert.equal(call.input.kind,'CONVERSATION_CORRECTION');assert.equal(call.input.responseCorrection.messageId,'real-answer');assert.equal(call.input.responseCorrection.expectedText,'Respuesta inicial sint\u00e9tica');assert.equal(call.input.responseCorrection.confirm,true);assert.deepEqual(call.input.responseCorrection.rememberFor,{kind:'TOPIC',label:'Explicaciones operativas'});
    await edit('Otra versi\u00f3n.');await page.getByRole('checkbox').check();await page.evaluate(()=>window.reject=true);await page.getByRole('button',{name:/^Guardar correcci/ }).click();await expect(page.getByRole('alert')).toContainText('denegada');await expect(page.getByLabel('Tu respuesta corregida',{exact:true})).not.toContainText('Otra versi\u00f3n.');
    await page.getByRole('textbox',{name:'Tema del recuerdo'}).fill('Tema no confirmado');await page.evaluate(()=>{window.reject=false;window.legacy=true});await page.getByRole('button',{name:/^Guardar correcci/ }).click();await expect(page.getByRole('alert')).toBeVisible();assert.equal(await page.evaluate(()=>window.topic),'Explicaciones operativas');
    await page.evaluate(()=>{window.legacy=false;window.hold=true});await page.getByRole('button',{name:/^Guardar correcci/ }).click();await page.waitForFunction(()=>typeof window.finish==='function');
    await page.evaluate(p=>window.renderProfile(p),{...profile,uid:'other-actor'});await page.evaluate(()=>window.finish());await expect(page.getByLabel('Tu respuesta corregida',{exact:true})).toHaveCount(0);
    for(const changed of [{...profile,rootId:'other-root'},{...profile,role:'operador'},{...profile,active:false},{...profile,disabled:true}]){
      await page.evaluate(p=>window.renderProfile(p),changed);await expect(page.getByLabel('Tu respuesta corregida',{exact:true})).toHaveCount(0);
    }
    await page.evaluate(p=>{window.message.responseCorrection={content:{bad:true}};window.renderProfile(p)},profile);await expect(page.getByLabel('Tu respuesta corregida',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Corregir respuesta',exact:true}).click();await page.getByRole('textbox',{name:'Respuesta corregida'}).fill('Recordatorio durable');await page.getByRole('textbox',{name:'Tema del recuerdo'}).fill('Tema nuevo');await page.getByRole('checkbox').check();await page.evaluate(()=>window.hold=false);await page.getByRole('button',{name:/^Guardar correcci/}).click();await expect(page.getByLabel('Tu respuesta corregida',{exact:true})).toContainText('Tema nuevo');await page.evaluate(()=>window.noChange=true);await page.getByRole('button',{name:/Dejar de recordar/}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Tu respuesta corregida',{exact:true})).toContainText('guardada');await page.evaluate(()=>window.noChange=false);await page.getByRole('button',{name:/Dejar de recordar/}).click();await expect(page.getByLabel('Tu respuesta corregida',{exact:true})).toContainText('retirada');
    if(await page.getByRole('button',{name:'Quitar tema actual',exact:true}).count())await page.getByRole('button',{name:'Quitar tema actual',exact:true}).click();
    await page.getByRole('textbox',{name:'Tema actual',exact:true}).fill('Tema elegido');await page.getByRole('button',{name:'Confirmar tema',exact:true}).click();await expect(page.getByText('Tema elegido',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Quitar tema actual',exact:true}).click();assert.equal(await page.evaluate(()=>window.topic),'');await page.evaluate(()=>window.sendCurrent());assert.equal(await page.evaluate(()=>window.calls.at(-1).input.correctionTopic),undefined);
    await page.evaluate(p=>{window.message={id:'conflict-answer',role:'assistant',text:'Revisa tus recuerdos',correctionChoices:[{id:'choice-a',content:'Primera declaracion',topic:{kind:'TOPIC',id:'topic',label:'Tema'}},{id:'choice-b',content:'Segunda declaracion',topic:{kind:'TOPIC',id:'topic',label:'Tema'}}]};window.renderProfile(p)},profile);await expect(page.getByRole('button',{name:'Retirar este recuerdo',exact:true})).toHaveCount(2);await page.getByRole('button',{name:'Retirar este recuerdo',exact:true}).first().click();await expect(page.getByRole('button',{name:'Retirar este recuerdo',exact:true})).toHaveCount(1);assert.equal(await page.evaluate(()=>window.calls.at(-1).input.memoryId),'choice-a');
    await page.evaluate(p=>{window.message={id:'personal-note-answer',role:'assistant',text:'Reporte canonico intacto',reportExport:{rows:[{clienteId:'notes-alfa',clienteNombre:'Alfa Demo'}]},personalNotes:[{id:'client-note',content:'Mi indicacion personal del cliente',topic:{kind:'CLIENT',id:'notes-alfa',label:'Alfa Demo'}}]};window.renderProfile(p)},profile);await expect(page.getByLabel('Tus indicaciones personales del cliente',{exact:true})).toContainText('Mi indicacion personal del cliente');await page.evaluate(()=>window.noChange=true);await page.getByRole('button',{name:/Retirar esta indicaci/}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Tus indicaciones personales del cliente',{exact:true})).toBeVisible();await page.evaluate(()=>window.noChange=false);await page.getByRole('button',{name:/Retirar esta indicaci/}).click();await expect(page.getByLabel('Tus indicaciones personales del cliente',{exact:true})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.message.text),'Reporte canonico intacto');assert.equal(await page.evaluate(()=>window.calls.at(-1).input.memoryId),'client-note');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',transport:'SYNTHETIC',component:'HugoResponseCorrection',checks:15}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
