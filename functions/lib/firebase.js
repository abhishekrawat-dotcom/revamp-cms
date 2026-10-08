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
//   events/{eventId}                             — the canonical Event (see lib/api.js's EVENT_FIELDS)
//     { name, slug, category, status, start, end, venue, city, description,
//       payment: { type, amount, currency }, sections: [{id, on}], nav: [{t, on}],
//       templateId, checklist: {...}, published, createdAt, updatedAt, createdBy,
//       structurePlan,    // GENERATED TEMPLATES only (lib/api.js's /api/plan-structure) — a FIELD on this
//                         // same doc, not a subcollection, latest plan wins:
//                         // { sections: [string, ...], generatedAt }  (nav/hero/footer always first/
//                         // present/last; the rest is Gemini's pick from the 7 "middle" library types)
//       theme             // { themeColor, headingFont, bodyFont,       // previousEdition sources ONLY —
//                         //   usedFallback: {color, font, noPreviousEditionSource},  // see lib/api.js's
//                         //   extractThemeFromPreviousEditionSources for the fallback this triggers
//                         //   heroImageUrl, heroImageStoragePath, heroImageError, generatedAt }
//     }
//   events/{eventId}/briefs/{briefId}            — one per uploaded overview doc
//     { sourceFileName, mimeType, storagePath,    // the uploaded file, in Storage (see below)
//       extracted: { theme, audience, tone, tracks: [string], speakerHints: [string],
//                    sponsorHints: [string], keyMessages: [string], inferredCategory },
//       model, createdAt }
//   events/{eventId}/sources/{sourceId}          — one per previous-edition/current-edition/competitor URL
//     { type: 'previousEdition' | 'currentEdition' | 'competitor', url, extractedSections: [{heading, body}],
//       colorSignals: [string], fontSignals: [string], fetchedAt }
//   events/{eventId}/drafts/{draftId}            — AI-generated output, kept separate from the user's own
//                                                   edits (those still live in editor-store.js's IndexedDB)
//     { templateId, sourceEventId, library: {...}, positioningNotes, model, generatedAt, skippedLibraries }
//   events/{eventId}/speakers/{id}        — name, desig, comp, photoUrl, logoUrl, colour, weight, status,
//                                            email, phone, li, bio, groupId, order, createdAt/updatedAt/By
//   events/{eventId}/speakerGroups/{id}   — name, order
//   events/{eventId}/sessions/{id}        — title, start, end, kind, speakerIds: [id], desc, room, weight,
//                                            groupId, order
//   events/{eventId}/agendaGroups/{id}    — name, date, order
//   events/{eventId}/partners/{id}        — name, url, logoUrl, weight, status, email, phone, contact, note,
//                                            tierId, order
//   events/{eventId}/partnerTiers/{id}    — name, weight, order
//   events/{eventId}/gallery/{id}         — imageUrl, caption, order
//   events/{eventId}/faqs/{id}            — question, answer, order
//   events/{eventId}/contacts/{id}        — label, name, email, phone, order
//   events/{eventId}/registrations/{id}   — written by the PUBLIC POST /api/register (no auth — this is the
//                                            one write path the published microsite itself calls):
//     { name, email, phone, company, designation, city, source, status: 'confirmed'|'waitlist'|'cancelled',
//       payment: { required, status: 'n/a'|'pending'|'paid'|'failed', amount, txnId },
//       createdAt, checkedInAt }
//
// Storage layout:
//   events/{eventId}/briefs/{fileName}       the uploaded overview doc, as-is
//   events/{eventId}/generated/{fileName}    any generated/selected imagery (banners, etc.)
//   events/{eventId}/published/index.html    the fully serialized, published page (lib/api.js's
//                                             POST /api/event/publish — canvas.serialize()'s own output,
//                                             made public; events/{eventId}.publishedUrl points here)
//   events/{eventId}/speakers/{fileName}, /partners/{fileName}, /gallery/{fileName}
//                                             speaker/sponsor photos and gallery images, uploaded as base64
//                                             in the request body (same pattern as handleExtractBrief's
//                                             docBase64) and stored here as real files — never inline as a
//                                             data: URI in Firestore (a single doc is capped at 1MiB; see
//                                             buildHeroImage's own comment on the bug this caused once already)
//
// Firestore/Storage security rules (firestore.rules, storage.rules, repo root) deny all direct client
// access — only this Admin SDK code (which bypasses rules) ever touches either; every read/write of this
// data goes through the /api/* endpoints in this folder. Admin write endpoints (creating/editing an event's
// own content) additionally require a verified Firebase Auth ID token — see requireAdmin() in lib/api.js —
// which IS a real client-side Firebase SDK concept: the browser holds a Firebase Web App config (apiKey/
// authDomain/appId, registered in the Firebase Console, not a secret — Firebase Auth is designed for public
// client use) purely to sign in and obtain that ID token. It never gets Firestore/Storage access directly;
// Firestore/Storage stay Admin-SDK-only exactly as before, the ID token is only ever verified here
// (admin.auth().verifyIdToken()), never used to grant the browser a live Firestore/Storage connection.
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
  if (app) return { db: admin.firestore(), bucket: admin.storage().bucket(), auth: admin.auth() };
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
  return { db: admin.firestore(), bucket: admin.storage().bucket(), auth: admin.auth() };
}

module.exports = { getFirebase };
