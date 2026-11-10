/**
 * Package entry. Cloud Run runs one function per service and sets FUNCTION_TARGET, so an instance only needs
 * the module that defines that function. Discovery (and anything without FUNCTION_TARGET) gets the full
 * export list from ./index. The name -> module map is generated from index.ts re-exports
 * (scripts/generate-lazy-function-map.mjs) and checked by qa/scripts/lazy-entry.test.cjs.
 */
import * as admin from "firebase-admin";
import { setGlobalOptions } from "firebase-functions/v2";
import { LAZY_MODULES } from "./lazyModules.generated";

// index.ts initialised the default app and the region before any module body ran, and several modules call
// getFirestore() at load. A lazily loaded module must find the same state.
setGlobalOptions({ region: "us-central1" });
if (!admin.apps.length) admin.initializeApp();

const target = process.env.FUNCTION_TARGET;
const entry = target ? LAZY_MODULES[target] : undefined;

if (entry && target) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  module.exports = { [target]: require(entry.module)[entry.export] };
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  module.exports = require("./index");
}
