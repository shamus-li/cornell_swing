# Swing Syndicate at Cornell

One React/Vite site and one Cloudflare Worker serve:

- `/` — the public website in `src/site/`
- `/check-in/` — the protected kiosk in `check-in/src/`
- `/check-in/api/*` — the check-in API in `check-in/worker/`

The Worker serves the built static assets, handles the API, and runs the nightly attendance sync. `index.html` and `check-in/index.html` are only Vite entry shells.

## Edit the public site

Edit `src/site/content.ts` for copy, links, carousel order, image descriptions, and the semester heading. The weekly schedule and special events load in parallel from the two published Google Sheet tabs, so changing those rows does not require a deployment.

To replace a carousel photo, choose its position from 1 to 4 and run:

```sh
npm run hero:image -- 2 /path/to/new-photo.jpg
```

This crops the photo to 3:2 and creates the responsive WebP sizes. Then update its `alt` description in `src/site/content.ts`.

## Develop and verify

```sh
npm ci
npm run dev
npm test
npm run build
```

`npm run dev` serves both React pages. To exercise the built site and Worker together with local secrets from `check-in/.dev.vars`, use `npm run dev:worker`.

`npm run worker:check` builds the site and validates the Worker bundle without deploying it. Run `npm run worker:types` after changing Worker bindings.

## Check-in data flow

Autocomplete sends search text in a POST body and reads a validated roster snapshot from KV. The nightly sync replaces that snapshot from Notion; only a missing or invalid snapshot causes an on-demand Notion read.

The first check-in on a calendar date seeds that date's Durable Object from only the timestamp, email, and member-ID Sheet columns. Its SQLite primary-key set rejects later duplicates without rereading the Sheet. A failed append releases its reservation so the user can retry.

The nightly sync compares Sheet-row fingerprints stored under `attendance-sync:v1`, sends only new or edited rows to Notion, retries failed rows, and sorts the Sheet only when it processed changes. If the fingerprint state is missing, the next run performs one full reconciliation. Partial row failures preserve successful progress but fail the cron invocation; sorting failures also fail the invocation and leave the checkpoint unchanged for retry.

## Deploy

Pushing `main` runs tests, builds and dry-runs the Worker, then deploys the single Worker only if every validation succeeds. Only the deployment step receives the Cloudflare token. The Worker's custom domain serves `swingsyndicate.club`; Cloudflare Access continues to protect the check-in path.

For an intentional manual deployment, run `npm run deploy` with `CLOUDFLARE_API_TOKEN` set.
