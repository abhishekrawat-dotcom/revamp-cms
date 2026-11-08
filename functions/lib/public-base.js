/* The one address the published event sites are reached at (owner decision #2, UX-001).

   WHY ONE SETTING: an event's address used to be made up on several pages ("etoneworld.com/<slug>" in the
   console and Create Event, "events.economictimes.indiatimes.com/<name>" on the dashboard and its QR codes),
   none of which resolves, while the site really answers at <this service>/e/<id>. Every address a person sees
   or copies is now built from this value: the server's own (canonical link, og:url, sitemap, robots.txt, the
   publish answer, mailers, Promotions' QR codes, share links) through api.js publicBaseFor(), and the pages'
   through the X-Public-Base header every /api/ answer carries (RevampCore.publicUrl reads it).

   PUBLIC_BASE_URL (apphosting.yaml or the environment) wins when it is set to a bare origin; otherwise it is
   the address the service is hosted at today. When ET's own domain is attached (UX-149), setting
   PUBLIC_BASE_URL — or changing DEFAULT_PUBLIC_BASE below — is the one change. Local work that should link to
   itself sets PUBLIC_BASE_URL=http://localhost:<port>.

   Node 20, CommonJS, no dependencies. */
'use strict';

/* where the service itself (the CMS) is hosted. The editor saves pages there, so an absolute address in a saved
   version is on this host, whatever the public base is later: tools/republish-current.js rewrites it with this,
   not with publicSiteBase(). */
var HOSTED_ORIGIN = 'https://revamp-cms--revamp-cms.us-east4.hosted.app';
/* until ET's own domain is attached, the sites are reached where the service is */
var DEFAULT_PUBLIC_BASE = HOSTED_ORIGIN;

/* "http://localhost:8123", "https://cms.example.com" — nothing else (no path, no credentials). */
function cleanOrigin(v) {
  if (typeof v !== 'string') return '';
  var m = /^(https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)\/?$/.exec(v.trim());
  return m ? m[1] : '';
}

/* read on every call, not once at load: a test (or a restart with a new value) sees the value set now */
function publicSiteBase() {
  return cleanOrigin(process.env.PUBLIC_BASE_URL || '') || DEFAULT_PUBLIC_BASE;
}

module.exports = { HOSTED_ORIGIN: HOSTED_ORIGIN, DEFAULT_PUBLIC_BASE: DEFAULT_PUBLIC_BASE, cleanOrigin: cleanOrigin, publicSiteBase: publicSiteBase };
