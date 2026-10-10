// The CLI deliberately strips NODE_COMPILE_CACHE from its SDK child environment.
// Enable the same version-scoped local cache as the existing startup warmup only
// during SDK discovery. Runtime handlers do not enable or write this cache.
// Node validates cached bytecode against the source and its own version.
if (process.env.FUNCTIONS_CONTROL_API === "true" && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  const { enableCompileCache } = require("node:module") as typeof import("node:module");
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  // A cache failure is a normal optimization miss; Node reports it without
  // throwing. Never replace normal module loading or suppress its exceptions.
  enableCompileCache(join(tmpdir(), `pay0-functions-discovery-node-${process.versions.node}`));
}
export {};
