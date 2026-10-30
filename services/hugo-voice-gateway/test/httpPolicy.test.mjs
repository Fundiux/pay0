import test from "node:test";
import assert from "node:assert/strict";
import { handleHttpRequest, isAllowedVoiceOrigin } from "../src/httpPolicy.mjs";

test("healthz returns JSON revision without credentials", () => {
  let code, headers, body;
  const res = { writeHead: (status, values) => { code = status; headers = values; }, end: value => { body = value; } };
  handleHttpRequest({ method: "GET", url: "/healthz" }, res, { service: "gateway", revision: "r1", version: "beta" });
  assert.equal(code, 200);
  assert.match(headers["Content-Type"], /application\/json/);
  assert.deepEqual(JSON.parse(body), { status: "ok", service: "gateway", revision: "r1", version: "beta" });
  handleHttpRequest({ method: "POST", url: "/healthz" }, res, {});
  assert.equal(code, 404);
});

test("voice upgrade accepts only configured PAY0 HTTPS origins", () => {
  const allowed = new Set(["https://pay-0-system.web.app"]);
  assert.equal(isAllowedVoiceOrigin("https://pay-0-system.web.app", allowed), true);
  assert.equal(isAllowedVoiceOrigin("https://evil.example", allowed), false);
  assert.equal(isAllowedVoiceOrigin("http://pay-0-system.web.app", allowed), false);
  assert.equal(isAllowedVoiceOrigin(undefined, allowed), false);
});
