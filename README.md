# Swing Syndicate at Cornell website

This repository has one Vite build with two React pages:

- `/` is the public website in `src/site/`.
- `/check-in/` is the protected kiosk in `check-in/src/`.

`index.html` and `check-in/index.html` are only Vite entry shells. Shared frontend components live in `src/components/`. The check-in API and nightly sync remain in `check-in/worker/`.

## Edit public content

Edit `src/site/content.ts` for homepage copy, links, carousel order, image descriptions, and the semester heading. The weekly schedule and Special Events still come from the published `Website Schedule` Google Sheet, so those rows update without a deployment.

To replace a carousel photo, choose its position from 1 to 4 and run:

```sh
npm run hero:image -- 2 /path/to/new-photo.jpg
```

That command crops the photo to the carousel's 3:2 frame and creates every responsive WebP size. After replacing a photo, update its `alt` description in `src/site/content.ts`.

## Develop and build

```sh
npm install
npm run dev
npm run test
npm run build
npm run preview
```

The Vite development server serves both `/` and `/check-in/`. `npm run build` type-checks the project and writes both pages to `dist/`.

Use `npm run dev:pages` when the local Cloudflare Pages Function and check-in Worker binding are needed. Deploy the Pages site with `npm run deploy:pages`; deploy the nightly synchronization Worker separately with `npm run deploy:sync`.
