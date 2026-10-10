import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..');
const dir=path.join(root,'services/pay0-sentinel-observation/producer-infra');
const main=fs.readFileSync(path.join(dir,'main.tf'),'utf8');
const variables=fs.readFileSync(path.join(dir,'variables.tf'),'utf8');
const outputs=fs.readFileSync(path.join(dir,'outputs.tf'),'utf8');
const terraform=process.env.PAY0_TERRAFORM_BIN||path.join(root,'services/pay0-sentinel-observation/infra/.terraform/verified-cli/terraform.exe');
let checks=0;
function check(value,message){assert(value,message);checks++;}
// Delimit actual top-level resource blocks rather than counting permission words
// in comments. Nested blocks close with indentation in these reviewed sources.
const resources=[...main.matchAll(/^resource "([^"]+)" "([^"]+)" \{\r?\n([\s\S]*?)^\}/gm)].map(([,type,name,body])=>({type,name,body}));
assert.deepEqual(resources.map(x=>x.type+'.'+x.name),[
 'google_project_service.kms','google_service_account.producer',
 'google_project_iam_custom_role.reader','google_project_iam_member.reader',
 'google_project_iam_custom_role.logger','google_project_iam_member.logger',
 'google_kms_key_ring.producer','google_kms_crypto_key.producer',
 'google_kms_crypto_key_version.producer','google_project_iam_custom_role.signer',
 'google_kms_crypto_key_iam_member.signer',
]);checks++;
for(const resource of resources){
 const expected=resource.type==='google_kms_crypto_key_iam_member'?'signer_count':resource.type==='google_project_iam_member'?resource.name+'_count':'provision_count';
 check(new RegExp('count\\s*= local\\.'+expected+'\\b').test(resource.body),'Every resource must be gated');
}
const resource=(type,name)=>resources.find(x=>x.type===type&&x.name===name).body;
check(!/^\s*(data|module|import)\s+"?/m.test(main),'No reads, external modules or automatic imports');
check(!/credentials\s*=|access_token\s*=|impersonate_service_account\s*=/.test(main),'No credentials or impersonation');
for(const name of ['reader','logger']){
 const member=resource('google_project_iam_member',name);
 check(/project\s*= local\.source_project/.test(member),'Source grants only');
 check(member.includes('member  = "serviceAccount:${google_service_account.producer[0].email}"'),'Exclusive member');
 check(member.includes(`google_project_iam_custom_role.${name}[0].name`),'Exact custom role');
}
check(resource('google_project_iam_member','reader').includes('expression = "resource.name == \'${local.database_resource}\'"'),'Database condition cannot broaden to prefix/collection fiction');
const signer=resource('google_kms_crypto_key_iam_member','signer');
check(/crypto_key_id\s*= google_kms_crypto_key\.producer\[0\]\.id/.test(signer),'Signer exact key');
check(signer.includes('serviceAccount:${google_service_account.producer[0].email}'),'Signer only producer');
check(/project\s*= local\.observation_project/.test(resource('google_project_iam_custom_role','signer')),'Signer role isolated');
check(/disabled\s*= var\.service_account_disabled/.test(resource('google_service_account','producer')),'SA disabled control');
check(/skip_initial_version_creation\s*= true/.test(resource('google_kms_crypto_key','producer')),'No automatic initial version');
check(/state\s*= "DISABLED"/.test(resource('google_kms_crypto_key_version','producer')),'Version disabled');
check(/algorithm\s*= "RSA_SIGN_PSS_3072_SHA256"/.test(main)&&/protection_level\s*= "SOFTWARE"/.test(main),'Exact algorithm');
check(!/rotation_period\s*=/.test(main),'No asymmetric auto-rotation');
for(const type of ['google_service_account','google_kms_key_ring','google_kms_crypto_key','google_kms_crypto_key_version'])check(/prevent_destroy\s*= true/.test(resource(type,'producer')),'Preserve identity/key history');
check(/output "producer_deployment_managed" \{\s*value = false\s*\}/.test(outputs),'No deployment claimed');
for(const [name,permission] of [['reader','read_permissions'],['logger','log_permissions'],['signer','sign_permissions']])check(new RegExp('permissions\\s*= local\\.'+permission).test(resource('google_project_iam_custom_role',name)),'Exact permission source');

assert(fs.existsSync(terraform),'Reviewed local Terraform required; no download');
const fixture=fs.mkdtempSync(path.join(root,'.firebase/producer-iac-'));
fs.writeFileSync(path.join(fixture,'main.tf'),variables);
fs.writeFileSync(path.join(fixture,'cli.tfrc'),'disable_checkpoint = true\n');
const env={};for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{CHECKPOINT_DISABLE:'1',TF_IN_AUTOMATION:'1',TF_CLI_CONFIG_FILE:path.join(fixture,'cli.tfrc'),TF_DATA_DIR:path.join(fixture,'data')});
function evaluate(input){
 fs.writeFileSync(path.join(fixture,'fixture.tfvars.json'),JSON.stringify(input));
 const result=spawnSync(terraform,['-chdir='+fixture,'console','-no-color','-var-file=fixture.tfvars.json'],{
  input:'jsonencode({count=local.provision_count,signerCount=local.signer_count,readerCount=local.reader_count,loggerCount=local.logger_count,disabled=var.service_account_disabled,source=local.source_project,observation=local.observation_project,region=local.region,db=local.database_resource,identity=local.producer_account_id,read=local.read_permissions,log=local.log_permissions,sign=local.sign_permissions})\n',
  encoding:'utf8',env,windowsHide:true,timeout:15000,maxBuffer:65536,
 });
 assert.equal(result.status,0,result.stderr);assert(!result.error);return JSON.parse(JSON.parse(result.stdout.trim()));
}
try{
 const empty=evaluate({});
 assert.deepEqual(empty,{count:0,signerCount:0,readerCount:0,loggerCount:0,disabled:true,source:'pay-0-system',observation:'pay0-sentinel-observe',region:'us-central1',db:'projects/pay-0-system/databases/(default)',identity:'pay0-listusers-observer',read:['datastore.entities.get','datastore.entities.list'],log:['logging.logEntries.create'],sign:['cloudkms.cryptoKeyVersions.useToSign']});checks++;
 const provision=evaluate({enable_provisioning:true});check(provision.count===1&&provision.signerCount===0&&provision.disabled,'Provision does not enable identity or signing');
 check(provision.readerCount===0&&provision.loggerCount===0,'Provision grants nothing');
 for(const [flag,field] of [['enable_read_grant','readerCount'],['enable_logging_grant','loggerCount'],['enable_signing_grant','signerCount']]){const off=evaluate({[flag]:true});check(off[field]===0,'Flag alone does not create binding');const on=evaluate({enable_provisioning:true,[flag]:true});check(on[field]===1&&['readerCount','loggerCount','signerCount'].filter(k=>k!==field).every(k=>on[k]===0),'Grants independent');}
 for(const name of ['reader','logger','signer']){const body=resource('google_project_iam_custom_role',name);check(/stage\s*= "GA"/.test(body)&&/prevent_destroy\s*= true/.test(body),'Roles GA and protected');}
 const isolatedFlag=evaluate({enable_signing_grant:true});check(isolatedFlag.count===0&&isolatedFlag.signerCount===0,'Signer alone cannot provision');
 const grant=evaluate({enable_provisioning:true,enable_signing_grant:true});check(grant.count===1&&grant.signerCount===1&&grant.disabled,'Grant does not enable SA/version');
 const enabledIdentity=evaluate({enable_provisioning:true,service_account_disabled:false});check(!enabledIdentity.disabled&&enabledIdentity.signerCount===0,'Identity enabling does not grant signing');
 console.log(`SENTINEL_PRODUCER_IAC_PASS checks=${checks} providers=0 plan=0 apply=0 cloudCalls=0`);
}finally{
 assert(fixture.startsWith(path.join(root,'.firebase')+path.sep));fs.rmSync(fixture,{recursive:true,force:true});
}
