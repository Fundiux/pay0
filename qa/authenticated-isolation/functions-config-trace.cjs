const Module = require("node:module");
const originalLoad = Module._load;
const traced = new WeakSet();

Module._load = function tracedLoad(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  if (request !== "firebase-functions" || !exported || typeof exported !== "object" || traced.has(exported)) return exported;
  const descriptor = Object.getOwnPropertyDescriptor(exported, "config");
  if (!descriptor || typeof descriptor.value !== "function") return exported;
  const originalConfig = descriptor.value;
  Object.defineProperty(exported, "config", {
    ...descriptor,
    value(...args) {
      console.error(`QA_FUNCTIONS_CONFIG_ACCESS_STACK\n${new Error("firebase-functions.config access").stack}`);
      return originalConfig.apply(this, args);
    },
  });
  traced.add(exported);
  return exported;
};
