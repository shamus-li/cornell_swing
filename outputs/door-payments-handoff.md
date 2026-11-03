# Handoff: Swing Syndicate door payments

Written 2026-11-03. Repo: `/Users/shamus/cornell_swing`, branch `main`. Commit `d0cd422` (door flow) is live; the fixes below are only in the working tree and on staging.

## Objective for this session
Prove the new payment matching on staging with one real Square cash sale, then ship the fixes to the real site. "Done" means:
- On staging, a sale rung up from the door phone checks in the right person.
- The temporary cash-through-Square path is removed.
- The fixes are committed, deployed, and Square is reconnected on the real site.
- Test sales are refunded and the Balance Sheet is clean.

Sweater Weather Swing on Nov 13, 2026 is the first event that charges at the door.

## Why the real site can't take card check-ins yet
Live `d0cd422` matches a card payment by a `door:<id>` note on Square's Payment. A real sale showed that note comes back empty, so card payers stay on "Confirming". Cash on the laptop and volunteers work. **Don't let attendees use the card option on the real site until this ships.**

## User decisions still in force
- Don't commit, push or deploy to the real site without asking. Pushing `main` deploys through `.github/workflows/deploy.yml`, which doesn't run database changes.
- Multiple phones and multiple laptops must work. Wrong-name taps are out of scope for now ("don't worry about the wrong name").
- Attendees pick their own ticket on the honor system. No volunteer PIN. No QR code on the laptop. No custom iPhone app. No "Charge again" button.
- On the real site, cash is recorded on the laptop with **I've paid**, without Square.
- The phone page runs in Safari and accepts the "Open in Square?" prompt.
- Most events are one day with Student and General tickets. Multi-day events have per-day times.
- Balance Sheet (`1VvZ_LG8_fNkqCuVqp_-3MBQPVFsAHl5mVo450IX1y00`) is the source of truth. Keep "Swing Syndicate finances" (`1dr9qYme0WLE_eJeTimI-AIOTM_xANwN2bZz3BEW-pqE`) and don't archive it.
- Kiosk wording should be friendly and short. The user wants screenshots before approving visual changes.
- Writing style and engineering preferences are in `~/.claude/CLAUDE.md`.

## What the assistant can't do
These need the user:
- Issuing Square refunds. The refund screen authorizes a debit on the club's account.
- Reading or entering Square secrets, or running `wrangler secret put`.
- Applying database changes on the real site, which auto mode blocked before.

Auto mode also blocked one attempt to add a row to the real database.

## Uncommitted work in the working tree
Verified with the waiver work below in the tree: 222 tests pass (`npx vitest run`) and `npx tsc --noEmit` is clean. The door fixes are deployed to staging as version `8534203c`. A real sale has **not** been through the newest matching.

- **Matching:** `src/events/square.ts` reads `/v2/orders/{order_id}` and finds `door:<charge id>` there. It needs the `ORDERS_READ` permission, so Square must be reconnected. A 401 or 403 clears the connection, and the Finances tab then asks to connect again.
- **Busy door fixes:**
  - The same person confirmed on two laptops is recorded once, even at the same instant (`settleAtDoor` in `check-in/worker/door.ts`).
  - A failed check-in is retried on the next sync.
  - Only one request checks Square per 5 seconds (`syncSquareIfStale` in `check-in/worker/index.ts`).
- **Phone page (`check-in/src/Door.tsx`):**
  - Heading is "Ready to pay", with full names.
  - The check-in time shows only when two names match.
  - The return tab closes right away.
  - The list updates every 2 seconds and when the page comes back on screen.
- **Laptop:** "Almost there, Maya!", and `check-in/src/TimedButton.tsx` gives the 30-second bar.
- **Manager:** **Open the door payment page** link at the top of the Finances tab.
- **Staging:** `wrangler.staging.jsonc`, `scripts/staging-seed.sql`, `scripts/staging-members.json`, `npm run deploy:staging`.
- **Tests:** `check-in/test/door-fuzz.test.ts` simulates a busy door. A one-off run of 60 doors with 80 people passed, on the previous matching code.

Not this work, so leave out of any commit: `migrations/events/0022_upstate_dances.sql` (another session's edit) and `tsconfig.tsbuildinfo`. The waiver work below is in the same tree; see that section before committing.

## Temporary code to remove before shipping
Staging sends cash through Square so tests avoid card fees. Remove:
- `tender` and `cashOnPhone` in `check-in/worker/index.ts`, `check-in/src/App.tsx`, `check-in/src/Payment.tsx`, `check-in/src/Door.tsx` and `check-in/src/mock.ts`. The phone should always send `CREDIT_CARD`.
- The test "sends cash to Square only on staging" in `check-in/test/door.test.ts`.

Keep the `env.STAGING` check in `handleWaiver`: it stops staging waivers reaching the real CampusGroups form. Its `STAGING` var is in both wrangler configs.

## Staging
https://staging.swingsyndicate.club. The whole site redirects to sign-in on every path checked, allowing only wl757@cornell.edu (Cloudflare Access app, policy "Staging testers"). It has its own database (`swing-events-staging`), KV and fake data, plus no Notion or Google credentials.

- It uses its own Square app, "Swing Syndicate staging", with the secret already set. That app reads the club's **real** Square account, which has no test mode for this flow.
- So staging sales are real records, and the live site's feed also writes them to the real Balance Sheet.
- I deleted staging's Square connection so it can be remade with the new permission.
- QR codes on staging lead to the real CampusGroups pages, so don't scan and submit them.
- Deploy with `npm run deploy:staging`, while checking `git status` so other sessions' unfinished edits don't go out.

## Next steps
1. **User:** on `staging.swingsyndicate.club/manage/?tab=finances`, click **Connect Square** and approve the new permission.
2. **User:** on the laptop at `/check-in/`, check in with a new email, pick the $1 Student ticket, and choose **Cash**.
3. **User:** on the iPhone at `/check-in/door/`, tap the name and finish the sale in Square. The laptop should say "Checked in" within about 30 seconds.
4. **Check the result:**
   ```bash
   npx wrangler d1 execute swing-events-staging --config wrangler.staging.jsonc --remote --json --command "SELECT status, paymentId, json_extract(attendee,'$.name') AS name FROM door_charges ORDER BY createdAt DESC LIMIT 5"
   ```
   A paid row has status `card` and a `paymentId`. If it stays `pending`, the order data doesn't hold the note the way the Dashboard shows it. Inspect the order's fields, and don't guess. The fallback is the last-tapped-name matching (see the session transcript), which only supports one phone.
5. Ideally test two phones finishing in the opposite order, then one real $1 card tap, which has never been tried. The user was leaning toward deciding this later.
6. Remove the temporary code, rerun tests and types, and ask the user before committing.
7. When approved: commit only this work, push, and watch the deploy. No new database change is needed, since `0020` is applied. Then the user clicks **Connect Square** on the real `/manage/?tab=finances`. Until then the first new sale clears the old connection and the Finances tab asks to reconnect, and sales wait in Square's list for up to 3 days.
8. Check the live pages and Finances tab.

## Cleanup owed
- **Refunds (user):** in Square Dashboard, Transactions, Nov 3: $2.00 Alan Fakename General, $1.00 Ada T. Student, $1.00 Grace S. Student, $1.00 `door:220c5ae3…` Grace S. Student. Plus any new test sales. Suggest refunding the $1 first and checking the Square balance, because the screen's debit wording is unclear for cash.
- **Balance Sheet:** the "Cash payments" row for Nov 3 in Transaction History (hidden column H `payments-2026-11-03`) should drop to $0 about 10 minutes after the refunds, and within 3 days of the sales. Then delete the row. Confirm the amount first, then ask.
- **Hidden $1 event on the real site:** was proposed, not created. The staging test may make it unnecessary.
- **Square:** the "Swing Syndicate website" app still lists the old `/manage/square/test` return address, which is harmless. The real phone page's address, `https://swingsyndicate.club/check-in/door/`, is registered.
- **Old price columns:** `studentPrice` and `generalPrice` remain unused in the database, to be dropped once nothing old can deploy.

## General Risk waiver screen: uncommitted here too
A separate session moved the waiver to its own screen before payment, with a button confirming it's signed (no real check). Its work is **uncommitted in this same working tree**, mixed into `check-in/src/App.tsx`, plus `check-in/src/Waiver.tsx` and `check-in/test/worker.test.ts`. Nothing about it has been reviewed here, and I don't know whether staging's deployed version includes it. Ask the user whether it ships with the door fixes or separately. Separating it means splitting `App.tsx` by hand. It may also need a redeploy to staging before anyone tests it.

## Known limits to mention
- **Wrong name:** paying under someone else's name checks that person in. There's no undo on the site.
- **Line speed:** roughly 2–3 card payers per minute per phone, which is an estimate.
- **Internet:** Tap to Pay needs a connection.
- **Refunds:** a refunded ticket still gets the person in. A cash entry made by mistake can't be undone on the site.
- **Laptop timer:** the laptop clears after 30 seconds, so someone who pays later doesn't see the CampusGroups QR codes there.
- **Alerts:** payment alert emails go to the address in the manager's Settings tab, and staging has none set.

## References
- Saved notes: `~/.claude/projects/-Users-shamus-cornell-swing/memory/` (`door-payments-plan.md`, `staging-site.md`, `swing-finance-sheet.md`)
- Full session transcript: `~/.claude/projects/-Users-shamus-cornell-swing/46ba5400-4f4d-4536-8aa7-514dde201ca9.jsonl`
- Square docs: [Point of Sale overview](https://developer.squareup.com/docs/pos-api/what-it-does), [mobile web technical reference](https://developer.squareup.com/docs/pos-api/web-technical-reference)
