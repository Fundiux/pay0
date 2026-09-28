// Firebase CLI Storage runtime currently parses each stdout chunk as JSON.
// Windows pipes may split a single long rules response. Frame only that owned
// Java runtime's output; never alter the rules or swallow their diagnostics.
const { StringDecoder } = require("node:string_decoder");
function createJsonFramer(emit) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  return chunk => {
    pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) emit(Buffer.from(line, "utf8"));
    }
    // Some runtime releases flush a complete frame without a newline.
    if (pending.trimStart().startsWith("{")) {
      try { JSON.parse(pending); } catch { return; }
      emit(Buffer.from(pending.trim(), "utf8"));
      pending = "";
    }
  };
}
exports.createJsonFramer = createJsonFramer;

const Module = require("node:module"), originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (request !== "cross-spawn" || !/[\\/]firebase-tools[\\/]lib[\\/]emulator[\\/]storage[\\/]rules[\\/]runtime\.js$/.test(parent?.filename || "")) return loaded;
  return { ...loaded, spawn(binary, args, options) {
    const child = loaded.spawn(binary, args, options);
    if (!args?.some(arg => /cloud-storage-rules-runtime[^\\/]*\.jar$/.test(String(arg))) || !child.stdout) return child;
    const originalOn = child.stdout.on;
    child.stdout.on = function (event, listener) {
      return originalOn.call(this, event, event === "data" ? createJsonFramer(listener) : listener);
    };
    return child;
  } };
};
