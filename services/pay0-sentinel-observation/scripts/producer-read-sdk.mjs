// Offline import. No ADC, service-account keys, token files, token URLs or production handlers.
import {createRequire} from 'node:module';
const dependency=createRequire(new URL('../../../functions/package.json',import.meta.url));
export const DATABASE='projects/pay0-sentinel-observe/databases/sentinel-observation';
const COL='sentinelIamReadProbes';
const fail=()=>{throw Error('SDK_PROBE_REFUSED');};
export function fixtureName(run){if(!/^[a-f0-9]{32}$/.test(run))fail();return `${DATABASE}/documents/${COL}/${run}`;}
export function createProbeClient(token){
 if(typeof token!=='string'||!/^[A-Za-z0-9._~+/-]{20,8192}={0,2}$/.test(token))fail();
 const grpc=dependency('@grpc/grpc-js'),{v1:{FirestoreClient}}=dependency('@google-cloud/firestore');
 let bearer=token;token=null;
 const callCredentials=grpc.credentials.createFromMetadataGenerator((_context,callback)=>{
  if(!bearer){callback(Error('CREDENTIAL_CLOSED'));return;}
  const metadata=new grpc.Metadata();metadata.set('authorization',`Bearer ${bearer}`);callback(null,metadata);
 });
 const sslCreds=grpc.credentials.combineChannelCredentials(grpc.credentials.createSsl(),callCredentials);
 const client=new FirestoreClient({projectId:'pay0-sentinel-observe',servicePath:'firestore.googleapis.com',port:443,
  sslCreds,gaxServerStreamingRetries:true,'grpc.max_receive_message_length':262144,'grpc.max_send_message_length':262144,'grpc.enable_retries':0});
 return{client,close:async()=>{bearer=null;await client.close();}};
}
const options=timeout=>({timeout,maxRetries:0,retry:{retryCodes:[]}});
export async function runReadProbe(handle,run,kind,budgetMs=20000){
 const name=fixtureName(run),client=handle.client;
 if(!['get','query'].includes(kind)||!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>20000)fail();
 let receivedDocument=false;
 try{
  if(kind==='get'){
   const [doc]=await client.getDocument({name,mask:{fieldPaths:['schema','synthetic','probeTag']}},options(budgetMs));
   if(doc?.name!==name||doc.fields?.schema?.integerValue!=='1'||doc.fields?.synthetic?.booleanValue!==true||doc.fields?.probeTag?.stringValue!==run||Object.keys(doc.fields||{}).length!==3)fail();
   return 'ALLOWED_EXACT_FIXTURE';
  }
  const stream=client.runQuery({parent:DATABASE+'/documents',structuredQuery:{from:[{collectionId:COL}],
   select:{fields:['schema','synthetic','probeTag'].map(fieldPath=>({fieldPath}))},where:{fieldFilter:{field:{fieldPath:'probeTag'},op:'EQUAL',value:{stringValue:run}}},limit:{value:2}}},options(budgetMs));
  let messages=0,documents=0;let timer;
  try{
   await new Promise((resolve,reject)=>{
    const stop=error=>{stream.cancel?.();stream.destroy();reject(error);};
    stream.on('data',row=>{try{if(++messages>3)fail();if(!row.document)return;receivedDocument=true;documents++;
     const doc=row.document;if(documents>1||doc.name!==name||doc.fields?.schema?.integerValue!=='1'||doc.fields?.synthetic?.booleanValue!==true||doc.fields?.probeTag?.stringValue!==run||Object.keys(doc.fields||{}).length!==3)fail();
    }catch(error){stop(error);}});
    stream.once('error',reject);stream.once('end',()=>documents===1?resolve():reject(Error('SDK_PROBE_REFUSED')));
    timer=setTimeout(()=>stop(Error('SDK_PROBE_TIMEOUT')),budgetMs);
   });
   return 'ALLOWED_EXACT_FIXTURE';
  }finally{if(timer)clearTimeout(timer);stream.cancel?.();stream.destroy();}
 }catch(error){if(!receivedDocument&&error?.code===7)return 'DENIED';if(!receivedDocument&&error?.code===5)return 'NOT_FOUND_INCONCLUSIVE';throw Error('SDK_PROBE_REFUSED');}
}
