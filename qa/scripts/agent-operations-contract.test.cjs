const assert = require("node:assert/strict");
const { AGENTS, TOOLS, canExecuteTool } = require("../../functions/lib/modules/agentOperations/contract.js");

assert.equal(new Set(AGENTS.map(row => row.id)).size, AGENTS.length);
assert.equal(AGENTS.find(row => row.id === "sentinel").kind, "DEFENSE");
assert.equal(AGENTS.find(row => row.id === "agent-creator").enabled, false);
const quotation = TOOLS.find(row => row.id === "quotation-recovery");
assert.equal(quotation.idempotent, true);
assert.equal(canExecuteTool(quotation, false, 1, false), true);
assert.equal(canExecuteTool(quotation, false, 2, false), true);
assert.equal(canExecuteTool(quotation, false, 3, false), false);
assert.equal(canExecuteTool(quotation, false, 1, true), false);
const proposal = TOOLS.find(row => row.id === "agent-proposal");
assert.equal(canExecuteTool(proposal, false, 1, false), false);
assert.equal(canExecuteTool(proposal, true, 1, false), true);
console.log("PASS agent contracts, authority, retry limits and kill switch");
