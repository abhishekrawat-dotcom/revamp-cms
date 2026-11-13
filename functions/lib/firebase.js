// The Firebase Admin SDK, set up once: Firestore, the Storage bucket and Firebase Auth for every backend module.
//
// WHERE IT RUNS. The same code in two places; only the credentials differ:
//   - production: server.js on Firebase App Hosting (backend "revamp-cms"). No key: the backend runs as its own
//     service identity, which admin.initializeApp() picks up by itself (Application Default Credentials).
//     FIREBASE_STORAGE_BUCKET comes from apphosting.yaml.
//   - local: tools/serve.js, the QA harness and the one-off scripts in tools/. A service account key from
//     tools/.env.local (never committed, never printed):
//       FIREBASE_SERVICE_ACCOUNT_JSON   the key file's JSON, as a single-line string, OR
//       FIREBASE_SERVICE_ACCOUNT_PATH   a path to the key .json file on disk
//     and FIREBASE_STORAGE_BUCKET.
//
// getFirebase() -> { db, bucket, auth } | { error }: never throws, so a route can answer 503 with the sentence.
//
// RULES. firestore.rules and storage.rules deny every direct client access; this Admin SDK is not bound by them,
// and every read and write goes through the server's routes (functions/lib/api.js and the modules it routes to).
// The pages use the Firebase client SDK only to sign in (auth.js): the ID token they send is verified here
// (lib/access.js verifySession), never used to give a browser Firestore or Storage. Pictures a visitor's browser
// loads are public by an object ACL the server sets when it writes them — storage.rules lists them by prefix.
//
// WHERE THINGS LIVE (the module named owns the shape; read it there rather than here):
//   Firestore
//     events/{eventId}                      the event: the fields a person sets (lib/api.js EVENT_FIELD_CHECKS) and
//                                           the server's own — createdAt (an event exists only with it: eventStateOf),
//                                           deletedAt, portal, site, published*, counters, settings, designPlan,
//                                           generatedSite (lib/generated-site.js), approvals' state …
//       speakers, speakerGroups, sessions, agendaGroups, partners, partnerTiers, gallery, faqs, contacts
//                                           the Content records (lib/api.js RESOURCES; pictures are addresses of
//                                           files, never the picture itself: lib/inline-pictures.js)
//       registrations, forms, stats         visitors' registrations, the registration forms, daily visits
//                                           (lib/api-audience.js, lib/api-forms.js)
//       leads, promoTemplates, promoAudiences, …   Promotions (lib/api.js RESOURCES, lib/promo*.js)
//       briefs, sources, drafts, generations/{runId}/sections   what Create Event's AI steps read and wrote
//       changes, approvals, publishes, activity   the site's versions, approvals, publishes and the History
//     events/import-{importId}              a Lovable import's record (lib/api.js LOVABLE IMPORT PIPELINE; lib/http.js
//                                           LEGACY_IMPORT_DOCS keeps the prefix reserved)
//     config/…                              team settings: access (lib/access-control.js), approvals
//     sharePreviews, dashChats, aiChats, promoIcons, aiQuota, the speaker and sponsor pages, …   each in its module
//   Storage (private unless storage.rules lists the prefix as public by ACL)
//     events/{eventId}/site/                the saved site: snapshot.json, page.html, versions/, drafts/ (previews)
//     events/{eventId}/published/index.html the page /e/{eventId} serves
//     events/{eventId}/staging/index.html   the staged copy: the page as last saved (/preview/{eventId}?staged=1)
//     events/{eventId}/briefs/              documents read by Create Event's brief step
//     events/{eventId}/<kind>/, generated/, media/, promo-*/, share-card/   pictures and videos (public by ACL)
//     events/import-{importId}/             a Lovable import's page, sections and assets
//     people/<kind>/<slug>/, promo-icons/   the speaker and sponsor pages' pictures, the mailer icons
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
  return null; // App Hosting: no key file — the backend's own service identity is used instead, see below
}

// Lazy singleton: cheap to call repeatedly from every request handler, only initializes once. Returns
// {error} (never throws) so callers can proxy a clear 503 back to the browser, same shape as callGeminiJson.
function getFirebase() {
  if (app) return { db: admin.firestore(), bucket: admin.storage().bucket(), auth: admin.auth() };
  if (initError) return { error: initError };

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    initError = 'FIREBASE_STORAGE_BUCKET is not set (apphosting.yaml when deployed, tools/.env.local locally).';
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
    : admin.initializeApp({ storageBucket: bucketName }); // App Hosting: Application Default Credentials
  return { db: admin.firestore(), bucket: admin.storage().bucket(), auth: admin.auth() };
}

module.exports = { getFirebase };
