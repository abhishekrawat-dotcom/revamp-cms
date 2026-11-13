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

## What the capture keeps

`server.js` `settlePage` / `finishPage` walk the page before reading it, so what its script would draw later
is in the markup: content revealed on scroll, every card of a carousel, every tab's content (with the
tab's own look, its background picture and progress bar), every FAQ answer and accordion panel (found by
`aria-controls`), and the top bar's look once scrolled. The page's own motion is recorded on the way
(`motionRecorder`): each entrance as the page opens or as an element comes into view (its keyframes, timing
and what the page watched to set it off), each loop, and each motion tied to the scroll — written on the
element as `data-rv-motion`, with the element left as its entrance ends. `templates/_shared/et-runtime.js`
brings all of these back to life on the imported page, motion included. A change here reaches new imports
only once this service is deployed again
(below); `tools/reimport-lovable.js` runs the same capture on an operator's own Chrome to import one
unsaved event again.

## How it is kept safe

The service opens, in a real browser, an address someone typed — on a public Cloud Run URL, in a container that
has the cloud's metadata service at `169.254.169.254`. `server.js` keeps it from being used against us:

- **Who may call it.** Every `POST /scrape` carries the shared secret (`X-Scraper-Secret`), compared in constant
  time. With no `SCRAPER_SECRET` set the service refuses everything (503).
- **What a call may ask.** A body of at most 4 KB (`{"url": "..."}`), an `http(s)` address on the standard port
  with no user name or password, whose host resolves only to public addresses. The address rules are
  `public-address.js`, an identical copy of `../functions/lib/public-address.js` (a test checks they match;
  change both together).
- **What the page may reach.** Every connection the browser makes — the page, its redirects, pictures, scripts,
  fetches, workers and web sockets — goes through a small proxy inside the process (`startGuard`). It resolves
  each host once per render, refuses any that is not a public address or not on port 80/443, and connects to
  exactly the address it checked, so a name cannot be re-pointed (DNS rebinding) between the check and the
  connection. One render may download at most 80 MB through it. WebRTC is kept off the network, downloads are
  refused and service workers are bypassed.
- **How much at once.** One render at a time per instance; up to 3 more calls wait their turn, each only while
  it can still finish inside the caller's own limit. Beyond that the answer is `429 {code: "busy"}`. A render
  has a hard time limit and a browser that will not close is killed.
- **What comes back.** Only a page that is one: an address that cannot be reached, answers an HTTP error, shows
  almost nothing, or shows a host's "no site here" page (a Lovable address with no project behind it) is
  answered with a code, never as a capture (BE-048). Markup over 6 MB is refused.
- **As whom.** The container runs as the image's unprivileged `node` user (`USER node` in the Dockerfile).
  Chrome's own sandbox stays off (`--no-sandbox`): it needs kernel features Cloud Run does not give a container.

## Deploying it

You need the `gcloud` CLI, authenticated against the `revamp-cms` GCP project (`gcloud auth login`,
`gcloud config set project revamp-cms`).

### Deploying a new version of the code (the usual case)

From this directory:

```bash
gcloud run deploy lovable-scraper-service --source . --project revamp-cms --region us-east4 --quiet
```

Do **not** add `--set-env-vars`: that would replace the service's environment, and with it the
`SCRAPER_SECRET` the main backend's `LOVABLE_SCRAPER_SECRET` must match. The service keeps its existing
memory, CPU, concurrency, timeout and instance settings. Afterwards `GET <service URL>/health` answers
`{"ok": true}`.

Optional, at the same time or later (none of these touches the environment): `--concurrency 1` lets Cloud Run
send a second import to another instance instead of queueing it behind the first in one (the code queues
safely either way), and `--max-instances 3` gives that room.

### Setting it up from scratch

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
  --concurrency 1 \
  --timeout 120 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars SCRAPER_SECRET=<paste the secret from step 1> \
  --allow-unauthenticated

# 3. The command above prints a Service URL (https://lovable-scraper-service-xxxxxxxxxx.us-east4.run.app).
#    Set that URL + the SAME secret from step 1 on the MAIN backend, then redeploy it:
firebase apphosting:secrets:set LOVABLE_SCRAPER_SECRET --project revamp-cms
#   (paste the same secret from step 1 when prompted)
```

`LOVABLE_SCRAPER_URL` (the Service URL from step 2, no trailing slash) is in the repo root `apphosting.yaml`'s
`env:` block.

### `--allow-unauthenticated`, and the stronger option

`--allow-unauthenticated` makes the service's URL public; the shared secret is then what refuses every other
caller (401), and the address rules and the guard above apply even to a caller that has it. The stronger option
is `--no-allow-unauthenticated` with the App Hosting backend's service account granted `roles/run.invoker` on
this service: Cloud Run itself then refuses anyone else before this code runs. It needs the main backend to send
a Google identity token with each call (`scrapeLovableUrl` in `functions/lib/api.js` sends only the secret
today), so it is an owner decision and a small code change, not a deploy flag alone.

### Why these resource numbers

- **`--memory 2Gi` / `--cpu 2`**: a single headless Chrome rendering a real page needs about this not to be
  OOM-killed or CPU-starved; this service does nothing else.
- **`--concurrency 1`**: one render per instance is what the code does anyway (a second call waits its turn);
  with 1, Cloud Run starts another instance for it instead.
- **`--timeout 120`**: above the code's own limits (a call is answered within 110 s, waiting included; a render
  stops at 105 s), so the code's clean `{error, code}` answer is what the caller gets, not Cloud Run cutting it.
- **`--min-instances 0`**: scales to zero when idle (imports are rare; the first one after idle starts Chrome
  cold).
- **`--max-instances 3`**: room for a few imports at once; raise if this gets heavier use.

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
Body:   {"url": "https://example.lovable.app/"}        (at most 4 KB)

200  {"html": "<!doctype html>..."}
400  {"error", "code": "bad-request" | "bad-url" | "blocked-address"}
401  {"error", "code": "unauthorized"}         missing/wrong X-Scraper-Secret
413  {"error", "code": "too-large"}            body over 4 KB
422  {"error", "code": "unreachable" | "source-http-error" (+ "httpStatus") | "empty-page" | "not-a-site" | "capture-too-large"}
429  {"error", "code": "busy"}                 a render is running and the queue is full (or the wait would run out)
503  {"error", "code": "not-configured"}       no SCRAPER_SECRET on this service
504  {"error", "code": "timeout"}              rendering took too long
500  {"error", "code": "render-failed"}        Chrome failed to launch, or any other unexpected failure
```

`GET /health` returns `{"ok": true}` with no auth. (`/healthz` answers the same, but Cloud Run's front end keeps
that path for itself, so from outside it is Google's 404.) The main backend words each code for the person
importing (`functions/lib/import-check.js`).

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

`functions/lib/scraper-service.test.js` runs `server.js`'s own code without Chrome: the secret check, the body
cap, the address rules, the guard proxy (refusing private addresses, internal names, other ports and a name that
also resolves privately; connecting to exactly the address it checked; cutting a render past its byte budget),
the one-render-at-a-time queue, the "is this a site" rule and the answer codes. The capture itself
(`settlePage` / `finishPage`) is exercised in a real Chrome by `functions/lib/imported-behaviour.test.js`.

This service's own `Dockerfile` has not been built or run anywhere -- there is no local Docker available in the
environment this was built in (that includes the non-root `USER node` and `PUPPETEER_CACHE_DIR` change of
13 Nov 2026). The real deploy (`gcloud run deploy` above) is the first time the Dockerfile itself is built and
run: after it, check `GET /health` and run one real import from the CMS.
