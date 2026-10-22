import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('Realtime instructions request Core retrieval after explicit private-topic selection without inventing remembered content or authority', () => {
  const source = fs.readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert(source.includes('Después de seleccionar un tema privado, consulta delegate_to_hugo_core para aplicar sus indicaciones; no supongas su contenido ni lo reconstruyas desde otro socket. Los resultados financieros siguen sus herramientas canónicas y ningún recuerdo cambia hechos ni permisos.'));
  assert(source.includes('instructions, tools: realtimeTools'));
});
