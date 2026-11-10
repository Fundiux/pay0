/**
 * SPIKE (not wired as package.json "main"). Cloud Run runs one function per service and sets FUNCTION_TARGET,
 * so an instance only needs the module that defines that function. Discovery runs without FUNCTION_TARGET and
 * still gets the full export list from ./index.
 */
const LAZY_MODULES: Record<string, string> = {
  getBusinessIndicators: "./modules/businessIndicators/callables",
};

const target = process.env.FUNCTION_TARGET;
const lazyModule = target ? LAZY_MODULES[target] : undefined;

if (lazyModule && target) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  module.exports = { [target]: require(lazyModule)[target] };
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  module.exports = require("./index");
}
