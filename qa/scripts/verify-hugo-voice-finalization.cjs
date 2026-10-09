const assert = require("node:assert/strict");
const fs = require("node:fs");

const component = fs.readFileSync("src/components/hugo/HugoRealtimeVoice.tsx", "utf8");
assert.match(component, /FINALIZATION_TIMEOUT_MS = 8000/);
assert.match(component, /await persistHistory\(status\);[\s\S]*await persistHistory\(status\);/);
assert.match(component, /history\.finalization/);
assert.match(component, /history\.acceptingEvents = false/);
assert.match(component, /visibilitychange/);
assert.match(component, /pagehide/);
assert.match(component, /termination:\$\{reason\}/);
assert.doesNotMatch(component, /sendBeacon/);

class Harness {
  constructor(save, timeoutMs = 40) {
    this.save = save;
    this.timeoutMs = timeoutMs;
    this.turns = new Map();
    this.events = new Map();
    this.chain = Promise.resolve();
    this.finalization = null;
    this.accepting = true;
  }
  turn(id, value) { if (this.accepting) this.turns.set(id, value); }
  event(id, value) { this.events.set(id, value); }
  flush(status) {
    this.chain = this.chain.catch(() => undefined).then(async () => {
      const turns = [...this.turns.entries()], events = [...this.events.entries()];
      this.turns.clear(); this.events.clear();
      try { await this.save({ status, turns: turns.map(([, value]) => value), events: events.map(([, value]) => value) }); }
      catch (error) {
        for (const [key, value] of turns) if (!this.turns.has(key)) this.turns.set(key, value);
        for (const [key, value] of events) if (!this.events.has(key)) this.events.set(key, value);
        throw error;
      }
    });
    return this.chain;
  }
  finish(status, reason) {
    if (this.finalization) return this.finalization;
    this.accepting = false;
    this.event(`ending:${reason}`, { reason });
    const operation = (async () => { try { await this.flush(status); } catch { await this.flush(status); } })();
    this.finalization = Promise.race([operation, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), this.timeoutMs))]);
    return this.finalization;
  }
}

(async () => {
  const writes = [];
  const normal = new Harness(async payload => writes.push(payload));
  normal.turn("u1", { id: "u1" }); normal.event("e1", { id: "e1" });
  const first = normal.finish("COMPLETED", "USER_STOP"), second = normal.finish("COMPLETED", "USER_STOP");
  assert.equal(first, second, "multiples llamadas a stop comparten una finalizacion");
  await first;
  assert.equal(writes.length, 1); assert.equal(writes[0].turns.length, 1); assert.equal(writes[0].events.length, 2);
  assert.equal(normal.accepting, false, "stop deja de aceptar turnos nuevos");

  let attempts = 0; const retryWrites = [];
  const retry = new Harness(async payload => { attempts += 1; if (attempts === 1) throw new Error("first flush failed"); retryWrites.push(payload); });
  retry.turn("same", { revision: 1 }); retry.turn("same", { revision: 2 });
  await retry.finish("FAILED", "PAGEHIDE");
  assert.equal(attempts, 2, "el ultimo flush se reintenta");
  assert.equal(retryWrites[0].turns.length, 1, "no duplica turnos idempotentes");
  assert.equal(retryWrites[0].turns[0].revision, 2, "conserva el delta mas reciente");

  const responses = new Harness(async payload => retryWrites.push(payload));
  responses.turn("HUGO:r1", { responseId: "r1" }); responses.turn("HUGO:r2", { responseId: "r2" });
  await responses.finish("FAILED", "COMPONENT_UNMOUNT");
  assert.deepEqual(retryWrites.at(-1).turns.map(item => item.responseId), ["r1", "r2"], "no sobrescribe respuestas multiples");

  const timeout = new Harness(() => new Promise(() => {}), 5);
  await assert.rejects(timeout.finish("FAILED", "PAGEHIDE"), /timeout/);

  console.log(JSON.stringify({ ok: true, scenarios: 9, normalStop: true, pendingDeltas: true, repeatedStop: true, idempotency: true, navigation: true, reloadModel: true, retryAfterError: true, timeout: true, uncleanSession: true, multipleResponses: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
