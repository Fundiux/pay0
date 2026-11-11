'use strict';
const assert = require('node:assert/strict');
const { AGENTS, CUSTOMER_FACING_AGENT_IDS, isCustomerFacingAgent } = require('../../functions/lib/modules/agentOperations/contract.js');

let checks = 0;
const ok = fn => { fn(); checks++; };

// The explicit list is exactly the customer-facing agents the owner named.
ok(() => assert.deepEqual([...CUSTOMER_FACING_AGENT_IDS], ['hugo', 'maria', 'sofia']));
// Every listed id is a real agent, so a rename in the catalog cannot silently drop one.
ok(() => { for (const id of CUSTOMER_FACING_AGENT_IDS) assert.ok(AGENTS.some(agent => agent.id === id), id); });
// Internal agents are all of the others and none is customer facing.
const internal = AGENTS.map(agent => agent.id).filter(id => !CUSTOMER_FACING_AGENT_IDS.includes(id));
ok(() => assert.deepEqual(internal.sort(), ['agent-creator', 'conciliacion', 'documentos', 'expediente', 'iq', 'pagos', 'sentinel', 'soporte']));
ok(() => { for (const id of internal) assert.equal(isCustomerFacingAgent(id), false, id); });
ok(() => { for (const id of CUSTOMER_FACING_AGENT_IDS) assert.equal(isCustomerFacingAgent(id), true, id); });
// Anything that is not a known id string is refused.
ok(() => { for (const value of [undefined, null, '', 'pay0', 'HUGO', 'nope', 5, {}, ['hugo']]) assert.equal(isCustomerFacingAgent(value), false, String(value)); });
console.log(`whatsapp-customer-facing-agents: ${checks} checks passed`);
