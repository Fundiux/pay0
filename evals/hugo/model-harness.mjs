import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases } from './cases.mjs';

// Offline recorder for model or human-reviewed outputs. An adapter module is
// supplied explicitly; this script never loads production credentials itself.
const [adapterPath, outputPath] = process.argv.slice(2);
if (!adapterPath || !outputPath) throw Error('Usage: node evals/hugo/model-harness.mjs ./isolated-adapter.mjs output.json');
const adapter = await import(pathToFileURL(resolve(adapterPath)).href);
if (typeof adapter.generate !== 'function') throw Error('Adapter must export async generate(caseData)');
const results = [];
for (const row of cases) {
  const response = await adapter.generate(row);
  results.push({ caseId: row.id, domain: row.domain, response: String(response.text || ''), model: response.model || null,
    promptVersion: response.promptVersion || null, toolNames: response.toolNames || [], reviewed: false });
}
writeFileSync(outputPath, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
