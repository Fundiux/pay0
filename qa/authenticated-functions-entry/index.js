// QA-only: exports the compiled, real callable without loading functions/lib/index.js.
const activity = require('../../functions/lib/modules/activityLog/callables.js');
exports.logAuthEventCallable = activity.logAuthEventCallable;
