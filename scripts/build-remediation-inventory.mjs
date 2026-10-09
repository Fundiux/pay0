import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = require('../functions/node_modules/typescript');
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const historicDir = 'docs/audits/pay0-security-sentinel-2026-10-07';
const outputDir = 'docs/remediation/2026-10-09';
const BASELINE = 'd206a6c812218dd83ebfe0a45dc8e365c62e6a1f';
const UNKNOWN = '__UNRESOLVED__';
const constructors = new Set(['onCall','onRequest','onDocumentWritten','onDocumentCreated','onDocumentUpdated','onDocumentDeleted','onSchedule','onTaskDispatched']);
const slash = value => value.replaceAll('\\','/');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export function parseCsv(text) {
  const records=[]; let row=[], value='', quoted=false;
  for(let i=0;i<text.length;i++) {const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(value);value='';}else if(c==='\n'&&!quoted){row.push(value.replace(/\r$/,''));records.push(row);row=[];value='';}else value+=c;}
  if(value||row.length){row.push(value.replace(/\r$/,''));records.push(row);}if(quoted)throw Error('Unclosed CSV quote');
  const header=records.shift();return records.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==header.length)throw Error('CSV column count mismatch');return Object.fromEntries(header.map((k,i)=>[k.replace(/^\uFEFF/,''),r[i]]));});
}
export function csv(rows, columns) {
  const cell=value=>{const s=typeof value==='object'?JSON.stringify(value):String(value??'');return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
  return [columns,...rows.map(r=>columns.map(k=>r[k]))].map(r=>r.map(cell).join(',')).join('\n')+'\n';
}
const files = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
export function createAnalyzer(root=ROOT) {
  const configPath=path.join(root,'functions/tsconfig.json');
  const config=ts.readConfigFile(configPath,ts.sys.readFile).config;
  const parsed=ts.parseJsonConfigFileContent(config,ts.sys,path.dirname(configPath));
  const program=ts.createProgram(parsed.fileNames,parsed.options), checker=program.getTypeChecker();
  const anchor=node=>`${slash(path.relative(root,node.getSourceFile().fileName))}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line+1}`;
  function declaration(node){let symbol=checker.getSymbolAtLocation(node);if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);return symbol?.valueDeclaration||symbol?.declarations?.[0];}
  function evaluate(node,env=new Map(),depth=0) {
    if(!node||depth>24)return UNKNOWN;
    if(ts.isStringLiteralLike(node)||ts.isNumericLiteral(node))return ts.isNumericLiteral(node)?Number(node.text):node.text;
    if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
    if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node))return evaluate(node.expression,env,depth+1);
    if(ts.isIdentifier(node)){if(env.has(node.text))return env.get(node.text);const d=declaration(node);return d&&ts.isVariableDeclaration(d)?evaluate(d.initializer,env,depth+1):UNKNOWN;}
    if(ts.isObjectLiteralExpression(node)){const o={};for(const p of node.properties){if(ts.isSpreadAssignment(p)){const v=evaluate(p.expression,env,depth+1);if(v&&typeof v==='object')Object.assign(o,v);else o.__unresolvedSpread=UNKNOWN;}else if(ts.isPropertyAssignment(p))o[p.name.getText().replace(/^['"]|['"]$/g,'')]=evaluate(p.initializer,env,depth+1);else if(ts.isShorthandPropertyAssignment(p))o[p.name.text]=evaluate(p.name,env,depth+1);}return o;}
    if(ts.isArrayLiteralExpression(node))return node.elements.map(e=>evaluate(e,env,depth+1));
    if(ts.isPrefixUnaryExpression(node)){const v=evaluate(node.operand,env,depth+1);return v===UNKNOWN?UNKNOWN:node.operator===ts.SyntaxKind.ExclamationToken?!v:node.operator===ts.SyntaxKind.MinusToken?-v:UNKNOWN;}
    if(ts.isBinaryExpression(node)){const l=evaluate(node.left,env,depth+1),r=evaluate(node.right,env,depth+1);if(l===UNKNOWN||r===UNKNOWN)return UNKNOWN;switch(node.operatorToken.kind){case ts.SyntaxKind.BarBarToken:return l||r;case ts.SyntaxKind.AmpersandAmpersandToken:return l&&r;case ts.SyntaxKind.EqualsEqualsEqualsToken:return l===r;case ts.SyntaxKind.ExclamationEqualsEqualsToken:return l!==r;case ts.SyntaxKind.PlusToken:return l+r;case ts.SyntaxKind.AsteriskToken:return l*r;default:return UNKNOWN;}}
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){const target=evaluate(node.expression.expression,env,depth+1),args=node.arguments.map(a=>evaluate(a,env,depth+1));if(typeof target==='string'&&node.expression.name.text==='startsWith'&&args[0]!==UNKNOWN)return target.startsWith(args[0]);}
    if(ts.isPropertyAccessExpression(node)){const d=declaration(node.name);if(d&&ts.isVariableDeclaration(d))return evaluate(d.initializer,env,depth+1);}
    return UNKNOWN;
  }
  function resolve(node,env=new Map(),chain=[],seen=new Set()) {
    if(!node||seen.has(node))return null;seen=new Set(seen).add(node);
    if(ts.isVariableDeclaration(node))return resolve(node.initializer,env,[...chain,node],seen);
    if(ts.isIdentifier(node)||ts.isPropertyAccessExpression(node)){const d=declaration(ts.isPropertyAccessExpression(node)?node.name:node);return d?resolve(d,env,chain,seen):null;}
    if(ts.isCallExpression(node)){
      const d=declaration(ts.isPropertyAccessExpression(node.expression)?node.expression.name:node.expression);
      const name=d?.name?.getText()||node.expression.getText();
      if(constructors.has(name)&&d?.getSourceFile().fileName.includes('firebase-functions')){
        const first=node.arguments[0]; const handler=node.arguments.at(-1);const v=evaluate(first,env);
        const options=v&&typeof v==='object'&&!Array.isArray(v)?v:typeof v==='string'&&v!==UNKNOWN?(name==='onSchedule'?{schedule:v}:{document:v}):{};
        return {type:name,options,handler,definition:chain[0]||node,constructor:node,chain};
      }
      if(d&&ts.isFunctionDeclaration(d)&&d.body){const next=new Map(env);d.parameters.forEach((p,i)=>next.set(p.name.getText(),evaluate(node.arguments[i]||p.initializer,env)));const returns=d.body.statements.filter(ts.isReturnStatement);if(returns.length===1)return resolve(returns[0].expression,next,[...chain,d],seen);}
    }
    return null;
  }
  function authEvidence(handler) {
    const evidence=[];let token=false;const seen=new Set();let visited=0;
    function walk(node,depth){if(!node||depth>3||seen.has(node)||visited++>1500)return;seen.add(node);
      if(ts.isIdentifier(node)){const d=declaration(node);if(d&&(ts.isFunctionDeclaration(d)||ts.isVariableDeclaration(d))&&!d.getSourceFile().fileName.includes('node_modules'))walk(ts.isVariableDeclaration(d)?d.initializer:d.body,depth+1);}
      if(ts.isCallExpression(node)){const name=node.expression.getText();if(/^(requireAuth|requireAuthLike|assertAuthorized|assert.*Auth|verifyIdToken)$/.test(name)||/\.verifyIdToken$/.test(name))evidence.push(`${anchor(node)}:${name}`);const d=declaration(node.expression);if(d?.getSourceFile().fileName.includes('/src/')||d?.getSourceFile().fileName.includes('\\src\\')){if(ts.isFunctionDeclaration(d))walk(d.body,depth+1);}}
      if(ts.isIfStatement(node)&&/auth/.test(node.expression.getText())&&/throw\s+new\s+HttpsError\(["']unauthenticated/.test(node.thenStatement.getText()))evidence.push(`${anchor(node)}:explicit unauthenticated rejection`);
      if(ts.isPropertyAccessExpression(node)&&/^(token|secret_token)$/.test(node.name.text))token=true;
      ts.forEachChild(node,n=>walk(n,depth));
    }
    walk(handler,0);return {evidence:[...new Set(evidence)].sort(),token};
  }
  return {program,checker,anchor,resolve,evaluate,authEvidence};
}
// Lexer keeps strings and comments opaque; braces inside paths are parsed as wildcards.
export function parseRules(source, service, file) {
  const tokens=[];const re=/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][\w]*|\s+|./g;
  for(const m of source.matchAll(re)){if(/^\s|^\/\/|^\/\*/.test(m[0]))continue;tokens.push({text:m[0],start:m.index,end:m.index+m[0].length});}
  const stack=[],matches=[],clauses=[];const line=offset=>source.slice(0,offset).split('\n').length;
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];if(t.text==='match'){
      const start=tokens[i+1]?.start;const match=source.slice(start).match(/^(\/(?:[^\s{}]|\{[^}\n]+\})+)\s*\{/);if(!match)throw Error(`${file}:${line(t.start)} invalid match`);
      const local=match[1],parent=stack.filter(s=>s.path).at(-1)?.path||'',full=parent+local;
      const block={path:full,line:line(t.start),local};matches.push(block);stack.push(block);
      const end=start+match[0].length;while(tokens[i+1]?.start<end)i++;continue;
    }
    if(t.text==='{')stack.push({});else if(t.text==='}')stack.pop();
    else if(t.text==='allow'){
      const block=stack.filter(s=>s.path).at(-1);if(!block)throw Error('allow outside match');let j=i+1;const methods=[];while(tokens[j]&&tokens[j].text!==':'){if(tokens[j].text!==',')methods.push(tokens[j].text);j++;}
      const conditionStart=tokens[j+1]?.start;while(tokens[j]&&tokens[j].text!==';')j++;if(!tokens[j])throw Error('unterminated allow');
      const condition=source.slice(conditionStart,tokens[j].start).trim();
      for(const method of methods.flatMap(m=>m==='read'?['get','list']:m==='write'?['create','update','delete']:[m]))clauses.push({service,file,path:block.path,method,originalMethods:methods.join(','),condition,line:line(t.start),matchLine:block.line});i=j;
    }
  }
  if(stack.length)throw Error('unbalanced rules');return {matches,clauses};
}
export const ruleKey=(service,p,method)=>`${service}|${p.replace(/\{[^}=]+(=\*\*)?\}/g,(_m,recursive)=>recursive?'{**}':'{}')}|${method}`;
function field(options,key,applicable=true){if(!applicable)return 'NO_APLICA';return Object.hasOwn(options,key)?options[key]:'NO_DECLARADO';}
export function buildInventory(root=ROOT) {
  const historical=parseCsv(fs.readFileSync(path.join(root,historicDir,'ATTACK-SURFACE.csv'),'utf8'));
  const oldAutomation=parseCsv(fs.readFileSync(path.join(root,historicDir,'AUTOMATIONS.csv'),'utf8'));
  const historicalByEntry=new Map(historical.map(r=>[r.entry,r]));
  const analyzer=createAnalyzer(root),{program,checker,anchor,resolve,authEvidence}=analyzer;
  const index=program.getSourceFile(path.join(root,'functions/src/index.ts'));
  const exports=checker.getExportsOfModule(checker.getSymbolAtLocation(index));
  const surface=[],automations=[];
  const base={evidence_scope:'REPOSITORY_CONFIG',deployment:'UNKNOWN',authorization_certification:'NOT_CERTIFIED'};
  for(const exported of exports){let symbol=exported;if(symbol.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);const decl=symbol.valueDeclaration||symbol.declarations?.[0];if(!decl)continue;
    const resolved=resolve(decl);const name=exported.name;const old=historicalByEntry.get(name);const exportDecl=exported.declarations?.[0];
    if(!resolved){surface.push({...base,id:`AS-FN-${name}`,entry_type:'UNRESOLVED_EXPORT',entry:name,implementation:anchor(decl),export_anchor:exportDecl?anchor(exportDecl):'',boundary:'UNKNOWN',authentication_evidence:'Constructor unresolved',legacy_ids:old?.id||''});continue;}
    const {type,options,handler}=resolved;const evidence=authEvidence(handler);const internal=!['onCall','onRequest'].includes(type);
    const boundary=internal?'INTERNAL':evidence.evidence.length?'SESSION_OBSERVED':evidence.token?'TOKEN_OBSERVED':'UNKNOWN';
    const row={...base,id:`AS-FN-${name}`,entry_type:type,entry:name,implementation:anchor(resolved.definition),export_anchor:exportDecl?anchor(exportDecl):'',constructor_anchor:anchor(resolved.constructor),factory_chain:resolved.chain.map(anchor).join(';'),boundary,authentication_evidence:internal?'Event/task/scheduler constructor; IAM not inspected':evidence.evidence.join(';')|| (evidence.token?'Token property observed; validity not certified':'No classified auth evidence in bounded handler/helper traversal'),legacy_ids:old?.id||'',legacy_anchor:old?.implementation||'',source_sha256:hash(fs.readFileSync(decl.getSourceFile().fileName))};
    surface.push(row);
    if(internal)automations.push({...row,name,type,options,document_pattern:field(options,'document',type.startsWith('onDocument')),schedule_literal:field(options,'schedule',type==='onSchedule'),time_zone:field(options,'timeZone',type==='onSchedule'),retry_literal:field(options,'retry',type.startsWith('onDocument')),retry_count:field(options,'retryCount',type==='onSchedule'),retry_config:field(options,'retryConfig',type==='onTaskDispatched'),rate_limits:field(options,'rateLimits',type==='onTaskDispatched'),historical_automation:oldAutomation.some(a=>a.id===row.id),idempotency_certified:'NOT_CERTIFIED',kill_switch_certified:'NOT_CERTIFIED'});
  }
  for(const [service,file] of [['firestore','firestore.rules'],['storage','storage.rules']]){
    const source=fs.readFileSync(path.join(root,file),'utf8'),parsed=parseRules(source,service,file);let baselineMatches=[];
    try {baselineMatches=parseRules(execFileSync('git',['show',`${BASELINE}:${file}`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}),service,file).matches;}catch{/* Unknown mapping is retained explicitly below. */}
    const legacyMatches=historical.filter(r=>r.entry_type===(service==='firestore'?'Firestore rule':'Storage rule')).map(r=>({...r,canonical:baselineMatches.find(m=>m.line===Number(r.implementation.split(':').at(-1)))?.path}));
    for(const scope of parsed.matches.filter(m=>!parsed.clauses.some(c=>c.matchLine===m.line))) {
      const key=ruleKey(service,scope.path,'scope');
      const legacy=legacyMatches.filter(r=>r.canonical&&ruleKey(service,r.canonical,'scope')===key);
      surface.push({...base,id:`AS-RULE-${hash(key).slice(0,20)}`,entry_type:`${service} rule scope`,entry:scope.path,method:'NO_ALLOW_DECLARED',implementation:`${file}:${scope.line}`,boundary:'SCOPE_ONLY',authentication_evidence:'Namespace/container match; not an independent grant',legacy_ids:legacy.map(r=>r.id).join(';'),legacy_anchor:legacy.map(r=>r.implementation).join(';'),source_sha256:hash(source)});
    }
    const grouped=new Map();for(const c of parsed.clauses){const key=ruleKey(service,c.path,c.method);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(c);}
    for(const [key,clauses] of grouped){const c=clauses[0],legacy=legacyMatches.filter(r=>r.canonical&&ruleKey(service,r.canonical,c.method)===key);surface.push({...base,id:`AS-RULE-${hash(key).slice(0,20)}`,entry_type:`${service} rule method`,entry:c.path,method:c.method,implementation:clauses.map(c=>`${file}:${c.line}`).join(';'),boundary:'RULE_CONDITION',authentication_evidence:'Complete allow conditions retained; helper semantics not certified',conditions:clauses.map(c=>({original_methods:c.originalMethods,condition:c.condition,condition_sha256:hash(c.condition),anchor:`${file}:${c.line}`,match_anchor:`${file}:${c.matchLine}`})),legacy_ids:legacy.map(r=>r.id).join(';'),legacy_anchor:legacy.map(r=>r.implementation).join(';'),source_sha256:hash(source)});}
  }
  const shellPath=path.join(root,'src/components/RootClientShell.tsx'),shell=ts.createSourceFile(shellPath,fs.readFileSync(shellPath,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  for(const page of files(path.join(root,'src/app')).filter(p=>/[/\\]page\.tsx$/.test(p))){const relative=slash(path.relative(path.join(root,'src/app'),path.dirname(page))),route='/'+relative.split('/').filter(p=>p&&!/^\(.+\)$/.test(p)).join('/');const env=new Map([['pathname',route]]);let classification=UNKNOWN;
    const visit=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)){const v=analyzer.evaluate(node.initializer,env);if(v!==UNKNOWN)env.set(node.name.text,v);if(node.name.text==='isLoginPage')classification=v;}ts.forEachChild(node,visit);};visit(shell);
    const old=historicalByEntry.get(route);surface.push({...base,id:`AS-UI-${route}`,entry_type:'Next page',entry:route,implementation:`${slash(path.relative(root,page))}:1`,boundary:classification===true?(route.includes('[token]')?'PUBLIC_TOKEN_UI':'PUBLIC_UI'):classification===false?'SESSION_UI':'UNKNOWN_UI',authentication_evidence:'src/components/RootClientShell.tsx:isLoginPage AST evaluated; RequireAuth/RouteAccessGuard wrap non-public branch; backend separately',legacy_ids:old?.entry_type==='Next page'?old.id:'',legacy_anchor:old?.entry_type==='Next page'?old.implementation:'',source_sha256:hash(fs.readFileSync(page))});}
  // Preserve every historical identity, including entries that no longer resolve to a current surface.
  const mapped=new Set(surface.flatMap(r=>(r.legacy_ids||'').split(';')));
  for(const old of historical)if(!mapped.has(old.id))surface.push({...base,id:`HISTORICAL-UNMAPPED-${old.id}`,entry_type:'HISTORICAL_UNMAPPED',entry:old.entry,boundary:'UNKNOWN',authentication_evidence:'Historical entry retained; current mapping unresolved or removed',legacy_ids:old.id,legacy_anchor:old.implementation});
  surface.sort((a,b)=>a.id.localeCompare(b.id));automations.sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(surface.map(r=>r.id)).size!==surface.length)throw Error('Duplicate surface ID');
  return {surface,automations,historical,oldAutomation};
}
export function writeInventory(root=ROOT){const result=buildInventory(root);const dest=path.join(root,outputDir);fs.mkdirSync(dest,{recursive:true});
  fs.writeFileSync(path.join(dest,'ATTACK-SURFACE.csv'),csv(result.surface,['id','entry_type','entry','method','implementation','export_anchor','constructor_anchor','factory_chain','boundary','authentication_evidence','conditions','authorization_certification','legacy_ids','legacy_anchor','source_sha256','evidence_scope','deployment']));
  fs.writeFileSync(path.join(dest,'AUTOMATIONS.csv'),csv(result.automations,['id','name','type','implementation','constructor_anchor','factory_chain','document_pattern','schedule_literal','time_zone','retry_literal','retry_count','retry_config','rate_limits','options','legacy_ids','legacy_anchor','historical_automation','idempotency_certified','kill_switch_certified','source_sha256','evidence_scope','deployment']));return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=writeInventory();console.log(JSON.stringify({surface:r.surface.length,automations:r.automations.length,historical:r.historical.length,unmapped:r.surface.filter(x=>x.entry_type==='HISTORICAL_UNMAPPED').length}));}
