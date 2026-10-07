// Firebase Admin SDK wiring for the AI site-generation pipeline (brief ingestion, previous-edition/competitor
// source snapshots, AI drafts) — the first real persistence layer in this repo; everything else is localStorage.
//
// Runs in two places with the SAME code: locally under tools/serve.js, and deployed as the Cloud Function in
// this folder. The only thing that differs between them is where credentials come from:
//   - Local dev: an explicit service account key, via tools/.env.local —
//       FIREBASE_SERVICE_ACCOUNT_JSON   the key file's JSON, as a single-line string, OR
//       FIREBASE_SERVICE_ACCOUNT_PATH   a path to the key .json file on disk (easier to paste than JSON-in-JSON)
//   - Deployed: no key needed at all — the Function runs as its own Firebase/GCP service identity, and
//     admin.initializeApp() with no credential picks that up automatically (Application Default Credentials).
// FIREBASE_STORAGE_BUCKET is required either way — tools/.env.local locally, functions/.env when deployed
// (Firebase Functions v2 loads that file into the runtime's environment automatically).
//
// Firestore schema (all under one Google Cloud project, same one Gemini billing can live in):
//   events/{eventId}
//     { name, date, location, previousEditionUrl, competitorUrls: [string],
//       templateId, createdAt, updatedAt }
//   events/{eventId}/briefs/{briefId}            — one per uploaded overview doc
//     { sourceFileName, mimeType, storagePath,    // the uploaded file, in Storage (see below)
//       extracted: { theme, audience, tone, tracks: [string], speakerHints: [string],
//                    sponsorHints: [string], keyMessages: [string] },
//       model, createdAt }
//   events/{eventId}/sources/{sourceId}          — one per previous-edition/current-edition/competitor URL
//     { type: 'previousEdition' | 'currentEdition' | 'competitor', url, extractedSections: [{heading, body}],
//       colorSignals: [string], fontSignals: [string], fetchedAt }
//   events/{eventId}/drafts/{draftId}            — AI-generated output, kept separate from the user's own
//                                                   edits (those still live in editor-store.js's IndexedDB)
//     { templateId, fills: [{from, section, fill}], themeSuggestion: {...},
//       model, tokenUsage, generatedAt }
//   events/{eventId}/jobs/{jobId}                — generation job status, for async/polling UIs
//     { status: 'pending'|'running'|'done'|'error', step, error, startedAt, completedAt }
//
// Storage layout:
//   events/{eventId}/briefs/{fileName}       the uploaded overview doc, as-is
//   events/{eventId}/generated/{fileName}    any generated/selected imagery (banners, etc.)
//
// Firestore/Storage security rules (firestore.rules, storage.rules, repo root) deny all client access —
// only this Admin SDK code (which bypasses rules) ever touches either; the browser never gets a Firebase
// client SDK config, everything goes through the /api/* endpoints in this folder.
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let app = null;
let initError = null;

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const p = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null; // deployed: no key file — the Function's own identity is used instead, see below
}

// Lazy singleton: cheap to call repeatedly from every request handler, only initializes once. Returns
// {error} (never throws) so callers can proxy a clear 503 back to the browser, same shape as callGeminiJson.
function getFirebase() {
  if (app) return { db: admin.firestore(), bucket: admin.storage().bucket() };
  if (initError) return { error: initError };

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    initError = 'FIREBASE_STORAGE_BUCKET is not set (tools/.env.local locally, functions/.env when deployed).';
    return { error: initError };
  }

  let serviceAccount;
  try {
    serviceAccount = loadServiceAccount();
  } catch (e) {
    initError = 'Could not parse the Firebase service account (FIREBASE_SERVICE_ACCOUNT_JSON/PATH): ' + e.message;
    return { error: initError };
  }

  app = serviceAccount
    ? admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket: bucketName })
    : admin.initializeApp({ storageBucket: bucketName }); // deployed: Application Default Credentials
  return { db: admin.firestore(), bucket: admin.storage().bucket() };
}

module.exports = { getFirebase };
