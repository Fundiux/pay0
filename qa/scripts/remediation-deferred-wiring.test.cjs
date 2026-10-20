const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(process.argv[2]||'.');
const required=new Map([
 ['createIqDepositHttpControlled',1],['runPagoDepositHttpCreateFlow',1],['runIqCreateInvoiceHttpA53',2],
 ['runIqCreateInvoiceBatchHttpA53',1],['runIqCreateDispersionHttpH4D85A50',1],['runIqPaymentApplicationHttpDirect',1],
]);
const counts=new Map();let roleCalls=0;
function walk(dir){for(const entry of fs.readdirSync(dir)){const file=path.join(dir,entry);if(fs.statSync(file).isDirectory()){walk(file);continue;}if(!file.endsWith('.ts'))continue;
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const shared=ast.statements.some(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text.endsWith('/sharedCallables/helpers')&&n.importClause?.namedBindings?.elements?.some(e=>e.name.text==='requireRole'));
 function visit(n){if(ts.isCallExpression(n)){
  const name=n.expression.getText(ast);
  if(required.has(name)){
   const options=n.arguments[0];assert(options&&ts.isObjectLiteralExpression(options),`${file}: ${name} requires explicit options`);
   assert(options.properties.some(p=>p.name?.getText(ast)==='authorizeBeforePost'),`${file}: ${name} missing current-authority callback`);
   counts.set(name,(counts.get(name)||0)+1);
  }
  if(shared&&name==='requireRole'){
   roleCalls++;const argument=n.arguments[0];assert(ts.isIdentifier(argument),`${file}: role input must retain canonical object identity`);
   let scope=n.parent;while(scope&&!ts.isFunctionLike(scope))scope=scope.parent;assert(scope);
   const bindings=[];function bind(x){if(ts.isVariableDeclaration(x)&&x.name.getText(ast)===argument.text)bindings.push(x);ts.forEachChild(x,bind);}bind(scope);
   assert.equal(bindings.length,1,`${file}: unambiguous role subject`);
   const init=bindings[0].initializer;assert(init&&ts.isAwaitExpression(init)&&ts.isCallExpression(init.expression)&&init.expression.expression.getText(ast)==='getMyUser',`${file}: role input bypasses canonical getMyUser`);
  }
 }ts.forEachChild(n,visit);}visit(ast);
}}
walk(path.join(root,'functions/src'));
for(const [name,count]of required)assert.equal(counts.get(name),count,`${name}: review all added or removed dispatch callsites`);
assert.equal(roleCalls,18,'Review new shared.requireRole consumers');
console.log('PASS deferred wiring: seven production dispatch callsites have authorization callbacks; 18 shared role consumers retain canonical identity');
