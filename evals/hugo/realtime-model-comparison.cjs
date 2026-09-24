const scenarios = [
  { id: 'conversation', prompt: 'Hugo, que hicimos hoy?', expectedRoute: 'ECONOMIC_VOICE' },
  { id: 'tool', prompt: 'Muestrame el estado de la solicitud S12345.', expectedRoute: 'DETERMINISTIC_TOOL' },
  { id: 'analysis', prompt: 'Compara seis meses de movimientos y explica anomalias.', expectedRoute: 'BRAIN_MODEL' },
];
const models = ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini'];
if (require.main === module) console.log(JSON.stringify({ mode: 'CONTROLLED_NOT_PRODUCTION', models, scenarios, measures: ['naturalidad','comprension_es','interrupciones','repeticiones','latencia','contexto','nombres','cantidades','herramientas','delegacion','costo_real'] }, null, 2));
module.exports = { models, scenarios };
