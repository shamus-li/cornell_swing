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

### Special events in Google Sheets

Use one row per activity in the **Special Events** tab of [Website Schedule](https://docs.google.com/spreadsheets/d/13UZD5ahlBMz33xVWwqqsor7CHcdPoL1xNYMDoqPoN4U/edit#gid=1922996257):

| Date | Time | Activity | Location | Title | URL |
| --- | --- | --- | --- | --- | --- |
| 2026-10-17 | 6:15–7:00 PM | Beginner swing crash course | Willard Straight Hall Memorial Room (4th floor) | | |
| 2026-10-17 | 7:00–10:00 PM | Live music | Willard Straight Hall Memorial Room (4th floor) | | |

- Repeat the date on every activity row; rows with the same date become one event. Do not merge cells.
- Keep activities in the order they should appear. Events follow the first appearance of each date.
- Title and URL are optional. Fill them in once per date; the first nonblank value is used. The title is shown in bold, or `TBA` if blank. A URL links the title.
- Enter Time as readable text with minutes on every time, such as `6:15–7:00 PM`, `7:00–10:00 PM`, or `TBA`. Activity is the name of that part of the event.
- Repeat Location for each activity. A shared location appears once; different locations appear beside their activities. Blank times and locations display `Time TBA` and `Location TBA`.
- A date-only row can reserve a future event before its details are known.

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
