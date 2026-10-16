import test from "node:test";
import assert from "node:assert/strict";
import { ResponseContinuationRegistry } from "../src/responseContinuationRegistry.mjs";

test("continues once after every tool output from a response is delivered", () => {
  const responses = new ResponseContinuationRegistry();
  assert.equal(responses.observeDone("r1", ["c1", "c2"]), false);
  assert.equal(responses.outputDelivered("r1", "c1"), false);
  assert.equal(responses.outputDelivered("r1", "c2"), true);
  assert.equal(responses.outputDelivered("r1", "c2"), false);
});

test("works when a fast tool finishes before response.done", () => {
  const responses = new ResponseContinuationRegistry();
  assert.equal(responses.outputDelivered("r1", "c1"), false);
  assert.equal(responses.observeDone("r1", ["c1"]), true);
});
