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

Run `npm test` for tests and `npm run build` to build the site. Pushing to `main` runs the checks and deploys the website.
