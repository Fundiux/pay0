import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const remoteReadOnly = args.includes("--remote-readonly");
const appRoot = path.resolve(remoteReadOnly ? process.cwd() : args[0] || process.cwd());
const hostingOrigin = "https://pay-0-system.web.app";
const nextCli = path.join(appRoot, "node_modules/next/dist/bin/next");
const buildFile = path.join(appRoot, ".next/BUILD_ID");
const endpoint = "https://us-central1-pay-0-system.cloudfunctions.net/telegramDownloadAction";
const dummy = "synthetic_download_bearer_".padEnd(43, "x");
const nextDummy = "second_synthetic_download_".padEnd(43, "y");
const pdf = Buffer.from("%PDF-1.4\n% SYNTHETIC LOCAL SMOKE ONLY\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
const check = (value, code) => { if (!value) throw new Error(code); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// No arbitrary remote targets, query-bearing URLs or network mutations are permitted.
function networkPolicy(url, method, origin, remote) {
  if (url.origin === new URL(endpoint).origin && url.pathname === new URL(endpoint).pathname) return "SYNTHETIC";
  if (url.origin !== origin) return "BLOCK_EXTERNAL";
  if (remote && (!["GET", "HEAD"].includes(method) || url.search || url.username || url.password)) return "BLOCK_REMOTE";
  if ([dummy, nextDummy].some(token => url.href.includes(token))) return "BLOCK_CAPABILITY";
  return "READ_OR_LOCAL";
}
async function portFree() {
  const server = net.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function isListening(port) {
  return await new Promise(resolve => { const socket = net.connect({host:"127.0.0.1",port});
    socket.once("connect",()=>{socket.destroy();resolve(true);});socket.once("error",()=>resolve(false)); });
}
let server, browser, port, phase="SETUP", browserClosed=false, serverClosed=false;
let intercepted=0, blockedRemote=0, expectedToken=dummy, holdResponse=false, releasePending=()=>{};
let remoteReadsAllowed=0, remoteAssetReadsAllowed=0, blockedSameOriginRequests=0, transportFailure=false;
const results=[];
try {
  check(args.length <= 1 && (remoteReadOnly || !args[0]?.startsWith("--")), "ARGUMENTS_INVALID");
  check(dummy.length===43, "SYNTHETIC_INPUT_INVALID");
  for (const [url, method, expected] of [
    [hostingOrigin+"/_next/static/example.js", "GET", "READ_OR_LOCAL"],
    [hostingOrigin+"/", "HEAD", "READ_OR_LOCAL"],
    [hostingOrigin+"/", "POST", "BLOCK_REMOTE"],
    [hostingOrigin+"/?token=synthetic", "GET", "BLOCK_REMOTE"],
    ["https://example.invalid/", "GET", "BLOCK_EXTERNAL"],
    [endpoint, "POST", "SYNTHETIC"],
    [endpoint+"?token=synthetic", "POST", "SYNTHETIC"],
  ]) check(networkPolicy(new URL(url), method, hostingOrigin, true)===expected,"NETWORK_POLICY_INVALID");
  results.push("network_policy_self_checks");
  let origin=hostingOrigin;
  if (!remoteReadOnly) {
  check(fs.existsSync(nextCli) && fs.existsSync(buildFile), "EXISTING_BUILD_REQUIRED");
  port=await portFree();origin=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,[nextCli,"start","--hostname","127.0.0.1","--port",String(port)],
    {cwd:appRoot,env:{...process.env,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1"},stdio:["ignore","pipe","pipe"],windowsHide:true});
  // Drain logs without printing request URLs, environment or capability fragments.
  server.stdout.on("data",()=>{});server.stderr.on("data",()=>{});
  phase="LOCAL_SERVER_READY";
  let ready=false;for(let attempt=0;attempt<120;attempt++){
    check(server.exitCode===null,"LOCAL_SERVER_EXITED");
    try{const response=await fetch(origin+"/descarga/documento",{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}
    await delay(250);
  }
  check(ready,"LOCAL_SERVER_TIMEOUT");
  }
  phase="BROWSER_LAUNCH";browser=await chromium.launch({headless:true});
  const context=await browser.newContext({acceptDownloads:true,serviceWorkers:"block"});
  await context.route("**/*",async route=>{
    const request=route.request();const url=new URL(request.url());
    const policy=networkPolicy(url,request.method(),origin,remoteReadOnly);
    // Intercept before the same-origin allowance; even malformed endpoint requests never reach the network.
    if(policy==="SYNTHETIC"){
      try {
      check(request.url()===endpoint,"TRANSPORT_URL");
      if(request.method()==="OPTIONS") {await route.fulfill({status:204,headers:{"access-control-allow-origin":origin,"access-control-allow-methods":"POST","access-control-allow-headers":"content-type"}});return;}
      check(request.method()==="POST","TRANSPORT_METHOD");
      check(url.search==="","TRANSPORT_QUERY");
      check(request.postData()===JSON.stringify({token:expectedToken}),"TRANSPORT_BODY");
      const headers=request.headers();check(!headers.referer,"TRANSPORT_REFERRER");check(!headers.authorization && !headers.cookie,"TRANSPORT_CREDENTIALS");
      intercepted++;const held=holdResponse;if(held)await new Promise(resolve=>{releasePending=resolve;});
      try { await route.fulfill({status:200,body:pdf,headers:{"content-type":"application/pdf","cache-control":"no-store",
        "content-disposition":"attachment; filename*=UTF-8''smoke-sintetico.pdf","access-control-allow-origin":origin,"access-control-expose-headers":"Content-Disposition"}}); } catch(error) { if(!held)throw error; } return;
      } catch { transportFailure=true;await route.abort("blockedbyclient").catch(()=>{});return; }
    }
    if(policy==="READ_OR_LOCAL"){
      if(remoteReadOnly){remoteReadsAllowed++;if(url.pathname.startsWith("/_next/") || ["script","stylesheet","font","image"].includes(request.resourceType()))remoteAssetReadsAllowed++;}
      // Do not follow HTTP redirects: each remote request must stay at the fixed origin.
      if(remoteReadOnly){
        try {
          const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:15000});
          if(response.status()>=300 && response.status()<400){blockedSameOriginRequests++;await route.abort("blockedbyclient");return;}
          await route.fulfill({response});
        } catch {transportFailure=true;await route.abort("blockedbyclient").catch(()=>{});}
        return;
      }
      await route.continue();return;
    }
    if(policy!=="BLOCK_EXTERNAL"){blockedSameOriginRequests++;await route.abort("blockedbyclient");return;}
    // All external traffic, including Firebase initialization, is blocked before network.
    blockedRemote++;await route.abort("blockedbyclient");
  });
  await context.addInitScript(({endpoint,dummy,nextDummy})=>{
    window.__downloadSmoke={erased:false,fetchChecks:[],signals:[],blobCreated:false};
    const replace=history.replaceState.bind(history);
    history.replaceState=(...args)=>{const result=replace(...args);window.__downloadSmoke.erased=location.hash==="";return result;};
    const create=URL.createObjectURL.bind(URL);URL.createObjectURL=object=>{window.__downloadSmoke.blobCreated=object instanceof Blob;return create(object);};
    const fetchOriginal=window.fetch.bind(window);window.fetch=(input,init)=>{
      if(String(input)===endpoint){window.__downloadSmoke.signals.push(init?.signal);window.__downloadSmoke.fetchChecks.push({erased:location.hash==="",method:init?.method==="POST",
        body:[dummy,nextDummy].some(token=>init?.body===JSON.stringify({token})),noReferrer:init?.referrerPolicy==="no-referrer",noCredentials:init?.credentials==="omit",noStore:init?.cache==="no-store"});}
      return fetchOriginal(input,init);
    };
  },{endpoint,dummy,nextDummy});
  let page=await context.newPage();
  phase="VALID_FRAGMENT";await page.goto(origin+"/descarga/documento#token="+dummy,{waitUntil:"networkidle"});
  await page.getByRole("button",{name:"Descargar",exact:true}).waitFor();
  check(await page.evaluate(()=>location.hash===""),"FRAGMENT_NOT_ERASED");
  check(!(await page.locator("body").innerText()).includes(dummy),"CAPABILITY_IN_DOM");
  const downloadPromise=page.waitForEvent("download");await page.getByRole("button",{name:"Descargar",exact:true}).click();
  const download=await downloadPromise;check(download.suggestedFilename()==="smoke-sintetico.pdf","DOWNLOAD_NAME");
  const stream=await download.createReadStream();check(stream,"DOWNLOAD_STREAM");const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  check(Buffer.concat(chunks).equals(pdf),"DOWNLOAD_BYTES");
  await page.getByRole("status").filter({hasText:"La descarga se ha enviado a tu navegador."}).waitFor();
  const observed=await page.evaluate(()=>window.__downloadSmoke);
  check(observed.erased && observed.blobCreated && observed.fetchChecks.length===1 && Object.values(observed.fetchChecks[0]).every(Boolean),"FETCH_INVARIANTS");
  check(intercepted===1,"POST_COUNT");results.push("valid_fragment_post_blob_download");
  phase="SAME_DOCUMENT_HASH";expectedToken=nextDummy;
  await page.evaluate(value=>{location.hash="#token="+value;},nextDummy);
  await page.waitForFunction(()=>location.hash==="");
  await page.getByRole("button",{name:"Descargar",exact:true}).waitFor();
  const secondDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Descargar",exact:true}).click();
  const second=await secondDownload;const secondStream=await second.createReadStream();const secondChunks=[];for await(const chunk of secondStream)secondChunks.push(chunk);
  check(Buffer.concat(secondChunks).equals(pdf),"SECOND_DOWNLOAD_BYTES");
  await page.getByRole("status").filter({hasText:"La descarga se ha enviado a tu navegador."}).waitFor();
  check(intercepted===2,"SECOND_POST_COUNT");
  check(await page.evaluate(()=>window.__downloadSmoke.fetchChecks.every(checks=>Object.values(checks).every(Boolean))),"SECOND_FETCH_INVARIANTS");
  results.push("same_document_hash_reentry");
  phase="INVALID_DURING_PENDING";holdResponse=true;expectedToken=dummy;
  await page.evaluate(value=>{location.hash="#token="+value;},dummy);await page.waitForFunction(()=>location.hash==="");
  await page.getByRole("button",{name:"Descargar",exact:true}).click();
  for(let i=0;i<50 && intercepted!==3;i++)await delay(100);check(intercepted===3,"PENDING_POST_MISSING");
  let staleDownloads=0;page.on("download",()=>staleDownloads++);
  await page.evaluate(()=>{location.hash="#token=invalid";});await page.waitForFunction(()=>location.hash==="");
  await page.getByRole("status").filter({hasText:"No se pudo descargar el documento. Solicita un enlace nuevo en Telegram."}).waitFor();
  check(await page.evaluate(()=>window.__downloadSmoke.signals.at(-1)?.aborted===true),"PENDING_NOT_ABORTED");
  releasePending();holdResponse=false;await delay(500);
  check(staleDownloads===0,"STALE_DOWNLOAD");
  check(await page.getByRole("button",{name:"Descargar",exact:true}).count()===0,"STALE_READY_STATE");
  results.push("invalid_hash_aborts_pending_no_stale_download");
  // A fresh document tests invalid entry rather than same-document hash navigation.
  await page.close();page=await context.newPage();
  phase="INVALID_FRAGMENT";await page.goto(origin+"/descarga/documento#token=invalid",{waitUntil:"networkidle"});
  await page.getByRole("status").filter({hasText:"No se pudo descargar el documento. Solicita un enlace nuevo en Telegram."}).waitFor();
  check(await page.evaluate(()=>location.hash===""),"INVALID_FRAGMENT_NOT_ERASED");
  check(await page.getByRole("button",{name:"Descargar",exact:true}).count()===0 && intercepted===3,"INVALID_FRAGMENT_FETCH");results.push("invalid_fragment_generic_no_fetch");
  phase="ADJOINING_ROUTES";
  for(const suffix of ["/descarga/documento/otro","/descarga/documento-falso","/descarga"]){
    await page.goto(origin+suffix,{waitUntil:"domcontentloaded"});
    await page.waitForURL(url=>url.pathname==="/login",{timeout:15000});
    check(await page.getByRole("heading",{name:"Descargar documento",exact:true}).count()===0,"ADJOINING_PUBLIC_LEAK");
  }
  results.push("three_adjoining_routes_require_login");
  check(!transportFailure,"SYNTHETIC_TRANSPORT_FAILED");
  await context.close();phase="PASS";
} catch(error) {
  // Never dump browser errors, traces, URLs, fragments, request bodies or captured server output.
  const code=/^[A-Z][A-Z0-9_]+$/.test(error?.message||"")?error.message:"CHECK_FAILED";
  console.error(JSON.stringify({status:"FAIL",phase,code}));process.exitCode=1;
} finally {
  releasePending();
  if(browser){await browser.close();browserClosed=!browser.isConnected();}else browserClosed=true;
  if(server && server.exitCode===null){server.kill();for(let i=0;i<40 && server.exitCode===null;i++)await delay(100);}
  serverClosed=port?!(await isListening(port)):true;
  if(!browserClosed||!serverClosed){console.error(JSON.stringify({status:"CLEANUP_FAILED",browserClosed,serverClosed}));process.exitCode=1;}
  console.log(JSON.stringify({status:process.exitCode?"FAIL":"PASS",mode:remoteReadOnly?"REMOTE_READONLY":"LOCAL",checks:results,interceptedSyntheticPosts:intercepted,
    blockedExternalRequests:blockedRemote,blockedSameOriginRequests,remoteRequestsAllowed:remoteReadsAllowed,remoteAssetReadsAllowed,
    remotePostsAllowed:0,serviceWorkers:"BLOCKED",localServerStarted:Boolean(server),browserClosed,serverClosed}));
}
