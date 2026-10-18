const { onRequest } = require("firebase-functions/v2/https");
exports.ping = onRequest((request, response) => response.status(200).send("synthetic-ok"));
