// NOT DEPLOYED, NOT USED — to be deleted (launch check BE-059), once the owner has rotated the keys it was once
// deployed with (functions/.env). The product runs on Firebase App Hosting: server.js -> functions/lib/web-server.js ->
// functions/lib/api.js. firebase.json has no functions block, so nothing deploys this file; were it deployed, it
// would answer every route WITHOUT the sign-in gate server.js puts in front of the API. Do not deploy it.
const { onRequest } = require('firebase-functions/v2/https');
const { handleApi } = require('./lib/api');

exports.api = onRequest(
  { secrets: ['GEMINI_API_KEY'], timeoutSeconds: 240, memory: '512MiB' },
  handleApi
);
