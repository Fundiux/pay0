import assert from 'node:assert/strict';
export const PRODUCER='finalizeSolicitudDocumentUpload',WORKER='processTelegramInvoiceNotificationQueue';
export const PREFIX='projects/pay-0-system/locations/us-central1';
export const CONTROL='projects/pay-0-system/databases/(default)/documents/telegramInvoiceDeliveryControl/current';
export const JOB=PREFIX+'/jobs/pay0-telegram-invoice-queue-v1';
export function workerCreateBody(baseline,source,commit,archiveSha256,labels){
 assert.equal(baseline.name,PREFIX+'/functions/'+PRODUCER);assert.equal(baseline.state,'ACTIVE');assert.equal(baseline.buildConfig.runtime,'nodejs22');assert.equal(baseline.buildConfig.environmentVariables?.GOOGLE_NODE_RUN_SCRIPTS,'');
 assert.match(commit,/^[a-f0-9]{40}$/);assert.match(archiveSha256,/^[a-f0-9]{64}$/);assert.match(source.generation,/^[1-9][0-9]*$/);
 assert.match(source.bucket,/^(?:gcf-v2-sources-751158244178-us-central1|gcf-v2-uploads-751158244178\.us-central1\.cloudfunctions\.appspot\.com)$/);
 assert(typeof source.object==='string'&&source.object.length>0&&!source.object.includes('..')&&!source.object.startsWith('/'));
 const firebase=JSON.parse(baseline.serviceConfig.environmentVariables.FIREBASE_CONFIG);assert.equal(firebase.projectId,'pay-0-system');assert(['pay-0-system.appspot.com','pay-0-system.firebasestorage.app'].includes(firebase.storageBucket));
 const secrets=baseline.serviceConfig.secretEnvironmentVariables.filter(s=>s.key==='TELEGRAM_BOT_TOKEN');assert.equal(secrets.length,1);assert.match(baseline.serviceConfig.serviceAccountEmail,/@(?:developer\.gserviceaccount\.com|[a-z0-9-]+\.iam\.gserviceaccount\.com)$/);
 return{name:PREFIX+'/functions/'+WORKER,environment:'GEN_2',labels:{...labels,'pay0-source-commit':commit,'firebase-functions-hash':archiveSha256.slice(0,40)},buildConfig:{runtime:'nodejs22',entryPoint:WORKER,source:{storageSource:source},environmentVariables:{GOOGLE_NODE_RUN_SCRIPTS:''},...(baseline.buildConfig.serviceAccount?{serviceAccount:baseline.buildConfig.serviceAccount}:{})},serviceConfig:{timeoutSeconds:120,availableMemory:'1Gi',availableCpu:'1',maxInstanceCount:1,minInstanceCount:0,maxInstanceRequestConcurrency:1,ingressSettings:'ALLOW_ALL',serviceAccountEmail:baseline.serviceConfig.serviceAccountEmail,secretEnvironmentVariables:secrets,environmentVariables:{FIREBASE_CONFIG:baseline.serviceConfig.environmentVariables.FIREBASE_CONFIG}}};
}
export function queueControlBody(current,owner,enable,epoch){
 assert.match(epoch,/^[a-f0-9-]{36}$/);assert.match(owner,/^invoice-queue-[a-f0-9-]{36}$/);
 if(current){assert.equal(current.name,CONTROL);assert.deepEqual(Object.keys(current.fields).sort(),['enabled','epoch','owner','schemaVersion']);assert.equal(current.fields.owner.stringValue,owner);assert.equal(current.fields.schemaVersion.integerValue,'1');assert.equal(current.fields.enabled.booleanValue,!enable,'CONTROL_ALREADY_TRANSITIONED');assert.equal(typeof current.updateTime,'string');assert.notEqual(current.fields.epoch.stringValue,epoch);}
 else assert.equal(enable,false,'FIRST_STATE_MUST_BE_PAUSED');
 return{name:CONTROL,fields:{schemaVersion:{integerValue:'1'},enabled:{booleanValue:enable},epoch:{stringValue:epoch},owner:{stringValue:owner}}};
}
export function schedulerBody(worker){
 assert.equal(worker.name,PREFIX+'/functions/'+WORKER);assert.equal(worker.state,'ACTIVE');assert.equal(worker.serviceConfig.service,PREFIX+'/services/'+WORKER.toLowerCase());const uri=new URL(worker.serviceConfig.uri);assert.equal(uri.protocol,'https:');assert(uri.hostname.endsWith('.a.run.app')||uri.hostname.endsWith('.run.app'));assert(uri.hostname.startsWith(WORKER.toLowerCase()+'-'));assert.equal(uri.pathname,'/');
 return{name:JOB,schedule:'* * * * *',timeZone:'Etc/UTC',attemptDeadline:'120s',retryConfig:{retryCount:0},httpTarget:{uri:worker.serviceConfig.uri,httpMethod:'POST',headers:{'Content-Type':'application/json'},body:Buffer.from('{}').toString('base64'),oidcToken:{serviceAccountEmail:worker.serviceConfig.serviceAccountEmail,audience:worker.serviceConfig.uri}}};
}
