import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [artifactArg, baselineAssetsArg, secondArtifactArg] = process.argv.slice(2);
assert(artifactArg && baselineAssetsArg, 'ARTIFACT_AND_BASELINE_ASSETS_REQUIRED');
const artifact=path.resolve(artifactArg),baseline=path.resolve(baselineAssetsArg);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=root=>fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>{
 assert(!entry.isSymbolicLink(),'OUTPUT_LINK');const file=path.join(root,entry.name);return entry.isDirectory()?files(file):[file];
});
const rows=root=>files(root).map(file=>({file:path.relative(root,file).replaceAll('\\','/'),sha256:hash(fs.readFileSync(file))}));
const actualAssets=rows(path.join(artifact,'lib/assets'));
assert.deepEqual(actualAssets,rows(baseline),'BASELINE_ASSET_PATH_OR_HASH_CHANGED');
const manifest=JSON.parse(fs.readFileSync(path.resolve(artifact,'../provenance.json'),'utf8'));
assert.deepEqual(rows(artifact),manifest.outputs,'ARTIFACT_PROVENANCE_MISMATCH');
assert.equal(manifest.esbuild,'0.28.2');assert.equal(manifest.candidateOnly,true);
const map=JSON.parse(fs.readFileSync(path.join(artifact,'lib/index.js.map'),'utf8'));
assert.equal(map.sourceRoot,undefined);assert.equal(map.sourcesContent,undefined);
for(const source of map.sources){assert(source.startsWith('../.debug/compiled/'));assert(!path.isAbsolute(source));assert(fs.existsSync(path.resolve(artifact,'lib',source)));}
for(const row of manifest.outputs.filter(row=>/\.(?:js|map|json)$/.test(row.file))){
 const text=fs.readFileSync(path.join(artifact,row.file),'utf8');
 assert(!text.includes(path.resolve('.'))&&!text.includes(path.resolve('.').replaceAll('\\','/')),'ABSOLUTE_WORKTREE_PATH');
}
if(secondArtifactArg)assert.deepEqual(rows(path.resolve(secondArtifactArg)),manifest.outputs,'BUILD_NOT_BYTE_REPRODUCIBLE');
console.log(JSON.stringify({assetFiles:actualAssets.length,artifactFiles:manifest.outputs.length,mappedSources:map.sources.length,reproducibilityChecked:!!secondArtifactArg,cloudCalls:0}));
