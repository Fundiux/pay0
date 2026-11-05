'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const ts=require('C:/Users/ebarr/Desktop/pay0-system/functions/node_modules/typescript');
const SOURCE='C:/Users/ebarr/Desktop/pay0-system/__untracked_archive/tools/whatsapp-qr-connector/node_modules/whatsapp-web.js/src/util/Injected/Utils.js';
const PIN='0d0f88565f481dbfeb9493b04b24033a2cb60f5fd2fd0e84e543b461d98878fe';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function extract(source,expectedSha256){
 if(sha(source)!==expectedSha256)throw Error('EXACT_SEND_SOURCE_PIN_MISMATCH');
 const file='exact-send-input.js',options={allowJs:true,noLib:true,noResolve:true,checkJs:false},host=ts.createCompilerHost(options);
 host.getSourceFile=(name,version)=>name===file?ts.createSourceFile(file,source,version,true,ts.ScriptKind.JS):undefined;
 host.fileExists=name=>name===file;host.readFile=name=>name===file?source:undefined;
 const program=ts.createProgram([file],options,host),sf=program.getSourceFile(file),checker=program.getTypeChecker();
 const assignments=[];function visit(node){if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&node.left.getText(sf)==='window.WWebJS.sendMessage'&&ts.isArrowFunction(node.right))assignments.push(node.right);ts.forEachChild(node,visit)}visit(sf);
 if(assignments.length!==1)throw Error('EXACT_SEND_ASSIGNMENT_BOUNDARY');const arrow=assignments[0],start=arrow.getStart(sf),end=arrow.end;
 const globals=new Set(['window','Object','Array','String','Number','Boolean','Math','Date','JSON','Promise','Set','Map','parseInt','parseFloat','undefined','NaN','Infinity','Uint8Array','Error','TypeError','URL','atob','btoa']);const free=new Set();
 function lexical(node){if(node.kind===ts.SyntaxKind.ThisKeyword||node.kind===ts.SyntaxKind.SuperKeyword||ts.isMetaProperty(node))throw Error('EXACT_SEND_LEXICAL_CONTEXT_REQUIRED');if(ts.isIdentifier(node)){
  const parent=node.parent;
  const property=ts.isPropertyAccessExpression(parent)&&parent.name===node || (ts.isPropertyAssignment(parent)||ts.isMethodDeclaration(parent))&&parent.name===node || ts.isBindingElement(parent)&&parent.propertyName===node;
  if(!property){const symbol=checker.getSymbolAtLocation(node),declarations=symbol?.declarations||[];if(declarations.some(d=>d.getStart(sf)<start||d.end>end))throw Error('EXACT_SEND_EXTERNAL_LEXICAL_'+node.text);if(!declarations.length){free.add(node.text);if(!globals.has(node.text))throw Error('EXACT_SEND_EXTERNAL_LEXICAL_'+node.text);}}
 }ts.forEachChild(node,lexical)}lexical(arrow);
 const boundaries=[];function boundary(node){if(ts.isReturnStatement(node)&&node.expression){const expression=node.expression;
  if(ts.isCallExpression(expression)&&expression.arguments.length===1&&expression.arguments[0].getText(sf)==='newMsgKey._serialized'&&expression.expression.getText(sf).replace(/\s/g,'')==="window.require('WAWebCollections').Msg.get")boundaries.push(node);
 }ts.forEachChild(node,boundary)}boundary(arrow);
 if(boundaries.length!==1)throw Error('EXACT_SEND_RECEIPT_BOUNDARY');
 const replacement=`{
  const collection = window.require('WAWebCollections').Msg;
  const serialized = value => typeof value === 'string' ? value : value?._serialized;
  const identity = key => {
    const remote=serialized(key?.remote), participant=key?.participant==null?null:serialized(key.participant);
    if(key?.fromMe!==true || typeof key.id!=='string' || !/^[A-Za-z0-9]{1,128}$/.test(key.id) || !/^[0-9]+(?:-[0-9]+)?(?::[0-9]+)?@(c\\.us|s\\.whatsapp\\.net|g\\.us|lid)$/.test(remote||'') || key.participant!=null && !/^[0-9]+(?::[0-9]+)?@(c\\.us|s\\.whatsapp\\.net|lid)$/.test(participant||''))return null;
    return JSON.stringify([true,remote,key.id,participant]);
  };
  const expected=identity(newMsgKey);if(!expected)return undefined;
  const candidates=collection.getModelsArray().filter(model=>identity(model?.id)===expected);
  return candidates.length===1 ? candidates[0] : undefined;
}`;
 const point=boundaries[0],functionSource=source.slice(start,point.getStart(sf))+replacement+source.slice(point.end,end);
 return{functionSource,sourceSha256:expectedSha256,functionSha256:sha(functionSource),freeIdentifiers:[...free].sort(),changedBoundaryCount:1};
}
function buildExactSendSource(){return extract(fs.readFileSync(SOURCE,'utf8'),PIN);}
module.exports={buildExactSendSource,extract,SOURCE,PIN};
