"use strict";
// Self-recovery of the enrolled WhatsApp connector: whenever it can no longer work it
// closes once, reports a stable reason and lets the supervisor relaunch it.
const assert = require("node:assert/strict");
const { runEnrolledConnector } = require("../../tools/whatsapp-qr-connector/enrolledConnector.cjs");
const binding = { id: "00000000-0000-4000-8000-000000000000" };
function setup({ operate, destroy, chats } = {}) {
  const callbacks = {}, timers = [], stops = [];
  let clock = 0, destroyed = 0;
  const client = { on: (n, cb) => { callbacks[n] = cb; }, initialize: async () => {}, getChats: chats || (async () => []),
    destroy: destroy || (async () => { destroyed++; }) };
  const transport = { getBinding: () => binding, operate: operate || (async () => ({ command: null })), synchronize: async () => ({ written: 0, quarantined: 0 }) };
  const start = () => runEnrolledConnector({ transport, client, encodeQr: async () => "qr", resetLocalSession: async () => {},
    setTimer: fn => { timers.push(fn); return fn; }, clearTimer: () => {}, onStopped: reason => stops.push(reason),
    now: () => clock, notReadyLimitMs: 300000, destroyTimeoutMs: 50 });
  return { callbacks, timers, stops, start, tick: ms => { clock += ms; }, destroyed: () => destroyed };
}
const flushAsync = () => new Promise(resolve => setTimeout(resolve, 5));
const checks = [];
async function test(name, fn) { await fn(); checks.push(name); }
(async () => {
  await test("watchdog sync failure after a healthy start stops with SYNC_FAILED", async () => {
    let fail = false;
    const s = setup({ chats: async () => { if (fail) throw Error("Attempted to use detached Frame"); return []; } });
    const running = await s.start();
    s.callbacks.ready(); await flushAsync();
    assert.deepEqual(s.stops, []);
    fail = true; await running.watchdog();
    assert.deepEqual(s.stops, ["SYNC_FAILED"]);
    await running.watchdog(); await running.poll();
    assert.deepEqual(s.stops, ["SYNC_FAILED"], "stops exactly once");
  });
  await test("a hung destroy still reports the stop after the timeout", async () => {
    const s = setup({ destroy: () => new Promise(() => {}) });
    const running = await s.start();
    s.callbacks.disconnected(); await new Promise(resolve => setTimeout(resolve, 120));
    assert.deepEqual(s.stops, ["DISCONNECTED"]);
    void running;
  });
  await test("never ready without a QR stops with NOT_READY_TIMEOUT", async () => {
    const s = setup(); const running = await s.start();
    s.tick(299000); await running.watchdog(); assert.deepEqual(s.stops, []);
    s.tick(2000); await running.watchdog(); assert.deepEqual(s.stops, ["NOT_READY_TIMEOUT"]);
  });
  await test("a pending QR waits for a person and is never restarted", async () => {
    const s = setup(); const running = await s.start();
    s.callbacks.qr("code"); await flushAsync();
    s.tick(3600000); await running.watchdog(); assert.deepEqual(s.stops, []);
    s.callbacks.authenticated(); await flushAsync();
    s.tick(301000); await running.watchdog(); assert.deepEqual(s.stops, ["NOT_READY_TIMEOUT"]);
  });
  await test("a lost heartbeat stops with HEARTBEAT_FAILED", async () => {
    let calls = 0;
    const s = setup({ operate: async () => { if (++calls > 1) throw Error("NETWORK"); return { command: null }; } });
    const running = await s.start();
    await assert.rejects(running.poll());
    assert.deepEqual(s.stops, ["HEARTBEAT_FAILED"]);
  });
  await test("an explicit stop does not ask for a relaunch", async () => {
    const s = setup(); const running = await s.start();
    await running.stop(); assert.deepEqual(s.stops, []);
  });
  console.log(JSON.stringify({ ok: true, checks }));
})().catch(error => { console.error(error); process.exit(1); });
