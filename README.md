# Swing Syndicate at Cornell

The website for Cornell’s swing dance club: [swingsyndicate.club](https://swingsyndicate.club).

Organizers manage events at `/manage` and check in dancers at `/check-in/`.

Built with React, TypeScript, and Vite. 

## Development

```sh
npm ci
npm run dev
```

`npm run dev` serves every page with sample data from `dev/mock-server.ts`, including the manager without signing in. Saves last until it restarts. Use `npm run dev:worker` to run the real Worker.

Run `npm test` for tests and `npm run build` to build the site. Pushing to `main` runs the checks, applies new migrations in `migrations/events` to the live database, then deploys the website. A failed migration stops the deploy.

Migrations run before the new code goes live, so the old code must still work with the new schema. To drop or rename something the code uses, first ship code that stops using it, then add the migration in a later push. Migrations don't undo: a revert leaves the schema as it is, so fix forward or restore with `wrangler d1 time-travel`. Apply SQL by hand only through `wrangler d1 migrations apply`, because anything else goes unrecorded and the next deploy runs that migration again.
