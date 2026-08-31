# Swing Syndicate at Cornell

One React/Vite site and one Cloudflare Worker serve:

- `/` — the public website in `src/site/`
- `/check-in/` — the protected kiosk in `check-in/src/`
- `/check-in/api/*` — the check-in API in `check-in/worker/`

The Worker serves the built static assets, handles the API, and runs the nightly attendance sync. The public homepage is pre-rendered from React during the build, then hydrated in the browser. The check-in page stays client-rendered.

## Edit the public site

Edit `src/site/content.ts` for copy, links, carousel order, image descriptions, and the semester heading. Each build includes the weekly schedule and special events from the two published Google Sheet tabs. The browser refreshes both tabs in parallel, so changing those rows still does not require a deployment.

To replace a carousel photo, choose its position from 1 to 4 and run:

```sh
npm run hero:image -- 2 /path/to/new-photo.jpg
```

This crops the photo to 3:2 and creates the responsive WebP sizes. Then update its `alt` description in `src/site/content.ts`.

The first carousel photo is preloaded at high priority and decoded with the initial paint. The next photo loads at low priority after it, and each selection queues the following photo; selecting an unloaded photo requests it immediately. Keep the carousel's `sizes` attribute in sync with the page widths in `styles.css` so phones and tablets request the appropriate image size.

### Special events in Google Sheets

Use one row per activity in the **Special Events** tab of [Website Schedule](https://docs.google.com/spreadsheets/d/13UZD5ahlBMz33xVWwqqsor7CHcdPoL1xNYMDoqPoN4U/edit#gid=1922996257):

| Date | Title | Time | Activity | Location | URL |
| --- | --- | --- | --- | --- | --- |
| 2026-10-17 | | 6:15–7:00 PM | Beginner swing crash course | Willard Straight Hall Memorial Room (4th floor) | |
| 2026-10-17 | | 7:00–10:00 PM | Live music | | |

- Repeat the date on every activity row; rows with the same date become one event. Do not merge cells.
- Keep activities in the order they should appear. Events follow the first appearance of each date.
- Title, Location, and URL belong to the whole event. Enter them once on the first row for that date, then leave them blank on additional activity rows. The first nonblank value for each field is used, ignoring `TBA` for Location; later values do not override it. The title is shown in bold, or `TBA` if blank. A URL links the title.
- Gray Title, Location, and URL cells mark additional rows with the same date. The sheet uses conditional formatting on `B2:B` and `E2:F` with `=AND($A2<>"",COUNTIF($A$2:$A2,$A2)>1)`; it is a visual cue, not a restriction or formula that fills cells.
- Enter Time as readable text with minutes on every time, such as `6:15–7:00 PM`, `7:00–10:00 PM`, or `TBA`. Activity is the name of that part of the event.
- The first known event location appears once above its activities. Blank or `TBA` locations and times are hidden. An activity without a known time still appears; rows with neither a known time nor an activity are omitted from the schedule.
- A date-only row can reserve a future event before its details are known.

## Develop and verify

```sh
npm ci
npm run dev
npm test
npm run build
npm run test:build
```

`npm run dev` serves both React pages. To exercise the built site and Worker together with local secrets from `check-in/.dev.vars`, use `npm run dev:worker`.

`npm run worker:check` builds the site and validates the Worker bundle without deploying it. Run `npm run worker:types` after changing Worker bindings.

### Search visibility

`scripts/build-site.mjs` builds the browser assets and a temporary server bundle in `dist-ssr/`, then renders the existing homepage into `dist/index.html`. Only `dist/` is deployed. The build fetches the two public Sheet CSVs in parallel and embeds their rows in both the rendered HTML and escaped JSON for hydration. Copy, FAQ, links, dates, locations, and activities are readable without JavaScript. No credentials or private check-in data are involved, and this adds only two public CSV requests per build, not runtime Worker requests.

The browser keeps the snapshot visible while fetching current Sheet rows, replacing each tab independently when it succeeds. If a refresh fails, its snapshot remains visible. A valid header-only tab clears that tab's events. The first browser render uses the snapshot's date to avoid hydration mismatches, then updates past-event styling to today's date in Ithaca.

Without JavaScript, the schedule reflects the last successful deployment; rebuilding refreshes that snapshot. Builds fail if either public Sheet is unavailable, takes more than 15 seconds, or lacks its Date header, so CI cannot deploy a broken fetch as an empty schedule. Local development still loads the Sheets directly.

Search titles, descriptions, canonical URL, and organization metadata live in `index.html`. The social preview uses the first carousel photo automatically. `public/sitemap.xml` lists only the homepage; `public/robots.txt` excludes check-in crawling, and the kiosk also has a `noindex` tag. These are search hints, not access controls—Cloudflare Access remains responsible for privacy.

`npm run test:build` checks the actual production HTML without executing JavaScript, verifies referenced assets exist, and checks public/private indexing boundaries. CI runs it after the build and before deployment.

After deployment, use Google Search Console to verify the `swingsyndicate.club` domain, submit `https://swingsyndicate.club/sitemap.xml`, inspect the homepage, and request indexing. Track impressions and clicks for Cornell swing dance, Cornell swing, Ithaca swing dance, and Lindy Hop searches. Ask the maintainers of the Cornell CampusGroups profile, current Cornell event listings, and relevant Ithaca dance directories to link to the canonical website. Technical improvements help discovery; they do not guarantee a particular ranking.

## Check-in data flow

Autocomplete sends search text in a POST body and reads a validated roster snapshot from KV. The nightly sync replaces that snapshot from Notion; only a missing or invalid snapshot causes an on-demand Notion read.

The first check-in on a calendar date seeds that date's Durable Object from only the timestamp, email, and member-ID Sheet columns. Its SQLite primary-key set rejects later duplicates without rereading the Sheet. A failed append releases its reservation so the user can retry.

The nightly sync compares Sheet-row fingerprints stored under `attendance-sync:v1`, sends only new or edited rows to Notion, retries failed rows, and sorts the Sheet only when it processed changes. If the fingerprint state is missing, the next run performs one full reconciliation. Partial row failures preserve successful progress but fail the cron invocation; sorting failures also fail the invocation and leave the checkpoint unchanged for retry.

## Deploy

Pushing `main` runs tests, builds and dry-runs the Worker, then deploys the single Worker only if every validation succeeds. Only the deployment step receives the Cloudflare token. The Worker's custom domain serves `swingsyndicate.club`; Cloudflare Access continues to protect the check-in path.

For an intentional manual deployment, run `npm run deploy` with `CLOUDFLARE_API_TOKEN` set.
