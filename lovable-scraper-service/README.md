# lovable-scraper-service

## What this is, and why it's a separate service

One piece of Revamp CMS's "Import from Lovable" feature (`create-event.html` -> `POST /api/import-lovable`
with `{importId, url}`) needs to render a live Lovable.app site with a real browser, because those sites
are client-rendered React SPAs -- a plain server-side `fetch()` only returns the empty pre-render shell.

The main backend (`functions/lib/api.js`, deployed via **Firebase App Hosting**) can't do this itself in
production: Firebase App Hosting builds its container with Google's automatic Cloud Native Buildpacks --
there is no Dockerfile for that service, and no way to `apt-get install` the system libraries headless
Chrome needs. In production that failed with:

```
Failed to launch the browser process!
/tmp/chromium: error while loading shared libraries: libnss3.so: cannot open shared object file
```

This directory is the fix: a tiny, separate service, deployed straight to **Cloud Run with a real
Dockerfile** (not through App Hosting's buildpack pipeline), whose only job is: receive a URL, render it
with real headless Chrome, hand back the rendered HTML. `functions/lib/api.js`'s `scrapeLovableUrl()` now
calls this service over plain HTTP instead of launching Chrome itself. Everything downstream of that one
function (image re-hosting, Storage, Firestore, the ZIP-upload input method) is completely unchanged.

## Deploying it

You need the `gcloud` CLI, authenticated against the `revamp-cms` GCP project (`gcloud auth login`,
`gcloud config set project revamp-cms`). From this directory:

```bash
# 1. Generate a long random secret -- this is the shared secret that authenticates calls from the main
#    backend. Save the output; you'll need it again in step 3.
openssl rand -hex 32

# 2. Deploy. --source builds and deploys straight from this directory's Dockerfile; no separate build step.
gcloud run deploy lovable-scraper-service \
  --source . \
  --project revamp-cms \
  --region us-east4 \
  --memory 2Gi \
  --cpu 2 \
  --concurrency 4 \
  --timeout 120 \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars SCRAPER_SECRET=<paste the secret from step 1> \
  --allow-unauthenticated

# 3. The command above prints a Service URL (https://lovable-scraper-service-xxxxxxxxxx.us-east4.run.app).
#    Set that URL + the SAME secret from step 1 on the MAIN backend, then redeploy it:
firebase apphosting:secrets:set LOVABLE_SCRAPER_SECRET --project revamp-cms
#   (paste the same secret from step 1 when prompted)
```

Then add `LOVABLE_SCRAPER_URL` (the Service URL from step 2's output, no trailing slash) to
`apphosting.yaml`'s `env:` block on the main app (already done in this change -- see the repo root
`apphosting.yaml`), push to `main` so Firebase App Hosting redeploys the main backend, and the "Import
from Lovable" URL input is live again.

### Why `--allow-unauthenticated`

This makes the service's URL public. That's intentional and safe here, for two reasons layered together:

1. **The shared-secret header** (`SCRAPER_SECRET` above / `X-Scraper-Secret` request header) rejects any
   request that doesn't know the secret with 401 -- this is the real access control.
2. The alternative (`--no-allow-unauthenticated`, GCP's real IAM auth) would require the *caller*
   (Firebase App Hosting) to mint a GCP identity token on every request -- real extra plumbing that
   Firebase App Hosting doesn't obviously support without more setup than this one feature justifies.

The shared secret is sufficient to stop this service being abused as an open "render any URL through
headless Chrome" SSRF proxy by anyone who finds the URL; it also has its own SSRF guard (see below) that
is independent of the secret and runs even for an authenticated caller.

### Why these resource numbers

- **`--memory 2Gi` / `--cpu 2`**: a single headless Chrome instance actually rendering a real page is the
  commonly-cited minimum for not getting OOM-killed or CPU-starved mid-render (2GiB / 2 vCPU is the
  standard recommendation for a dedicated single-purpose Puppeteer-on-Cloud-Run service, not a
  shared-with-other-routes backend). Unlike the reverted bump in the main app's `apphosting.yaml`, this
  number is now sized for a service that does *nothing but* this.
- **`--concurrency 4`**: caps how many simultaneous renders one container instance will attempt. Each
  in-flight render holds a real Chrome process in memory for the life of the request (up to the ~55s hard
  timeout in `server.js`); a low number here is what keeps one instance from trying to run many Chrome
  processes at once inside the 2GiB budget above.
- **`--timeout 120`**: the request-level ceiling Cloud Run itself enforces, set comfortably above
  `server.js`'s own internal 55s hard timeout so that internal timeout -- which always closes Chrome
  cleanly and returns a real `{error}` -- is what fires first, not Cloud Run abruptly killing the request.
- **`--min-instances 0`**: scales to zero when idle, same reasoning as the main app's own
  `apphosting.yaml` (this is used rarely, no cost while unused; the first request after idle is slower
  because Chrome has to launch cold).
- **`--max-instances 2`**: matches the main app's own ceiling; raise if this gets heavier use.

## Required environment variables

| Variable         | Set on                | Value                                                              |
|-------------------|-----------------------|---------------------------------------------------------------------|
| `SCRAPER_SECRET`  | this service          | a long random secret (see step 1 above)                            |
| `LOVABLE_SCRAPER_URL`    | main backend (`apphosting.yaml`) | this service's Cloud Run URL, no trailing slash          |
| `LOVABLE_SCRAPER_SECRET` | main backend (`apphosting.yaml`, as a secret) | the SAME value as `SCRAPER_SECRET` above |

## The endpoint

```
POST /scrape
Header: X-Scraper-Secret: <SCRAPER_SECRET>
Body:   {"url": "https://example.lovable.app/"}

200  {"html": "<!doctype html>..."}
400  {"error": "..."}   bad/missing url, or the url fails the SSRF guard
401  {"error": "..."}   missing/wrong X-Scraper-Secret
504  {"error": "..."}   rendering took too long
500  {"error": "..."}   Chrome failed to launch, or any other unexpected failure
```

`GET /healthz` returns `{"ok": true}` with no auth, for Cloud Run's own health checking / a quick manual
check that the service is up.

## Local development

```bash
cd lovable-scraper-service
npm install
SCRAPER_SECRET=dev-secret node server.js
# in another terminal:
curl -s -X POST http://localhost:8080/scrape \
  -H "Content-Type: application/json" \
  -H "X-Scraper-Secret: dev-secret" \
  -d '{"url":"https://example.com/"}'
```

To point the main backend's local dev server (`node tools/serve.js`) at a locally-running copy of this
service instead of a deployed one, set in `tools/.env.local`:

```
LOVABLE_SCRAPER_URL=http://localhost:8080
LOVABLE_SCRAPER_SECRET=dev-secret
```

## What's NOT tested by anyone's local run

This service's own `Dockerfile` has not been built or run anywhere in this change -- there is no local
Docker available in the environment this was built in. `server.js`'s actual logic (render, secret check,
SSRF guard) was tested by running `node server.js` directly, which exercises the exact same code the
Dockerfile will run, just not inside the container image itself or against the real `npm install`-via-apt
package list. The real deploy (`gcloud run deploy` above) is the first time the Dockerfile itself is
actually built and run, and is a manual step the user still needs to do.
