# Eurovision 2026 Rankings

A private, mobile-first watch-party app for previewing Eurovision 2026 songs, keeping personal quarter-point taste and prediction rankings during the show, deriving the house ranking from everyone's scores, and tracking official Eurovision results.

## Why It Works This Way

This app is built around a small watch party, not a public scoreboard. The goal is to make finals night easy: preview the songs before the show, score them live while they perform, and compare the house result when everyone is done.

`My Rankings` is score-driven. Each person scores songs from `0` to `12` in `.25` increments in two lenses: taste (`how much did I enjoy it?`) and prediction (`how well do I think Eurovision will rank it?`). The page can sort either live ranking without needing a separate manual ranking step after every performance.

The average score ranking is also score-driven. The `Results` page averages everyone's taste scores and prediction scores separately. Ties fall back to running order/country sorting in the app logic, so if you care about exact ordering between two songs, give them slightly different quarter-point scores.

Group rankings are not shown on `My Rankings` because that page is for personal scoring. Group averages and the average score ranking live on `Results`, so nobody's live scores steer the room too early.

Official Eurovision tallies are separate from house scores. Taste scores answer "what did we like?", prediction scores answer "what did we think would happen?", and official tallies answer "what happened in Eurovision?" The app keeps all three so the party can compare them.

## How To Use

1. Start the app and open `http://localhost:5173`.
2. Join the room with the room code, default `ILOVEDAN`, and your display name.
3. Use `Preview` before the show to read each artist description in running order. Tap `Play` on a row to expand the inline YouTube player.
4. Use `My Rankings` during the show. Score each song from `0` to `12` in performance order on the left for taste and prediction; the ranking board on the right can flip between both rankings.
5. Use `Results` to see the score-derived average rankings, the sortable user score table, taste-vs-prediction insights, and imported or manually entered official Eurovision results.
6. Use `Admin` for finals-night maintenance: official result import, watcher toggle, room reset, and manual official score entry. Admin is PIN-protected; the local default PIN is `1234`.

## Entering Official Tallies

Go to `Admin`, unlock it with the admin PIN, then use each country row:

- `Run`: the Grand Final running order.
- `Place`: the official final placement.
- `Total`: official total points.
- `Jury`: official jury points.
- `Audience`: official televote/audience points.

Official result fields auto-save shortly after you edit them. Each row shows a subtle save status. These values appear in the `Official Eurovision Results` panel on `Results`.

`Pull official now` attempts to import official results from Eurovision's site. `Toggle watcher` starts or stops a best-effort poller that keeps checking the official page. Manual entry remains the dependable fallback because official pages can change markup during live events.

The database can store country-by-country vote rows imported by the watcher/importer, but the app does not currently expose a manual country-by-country vote entry grid. Manual admin entry is for each entry's running order, final place, total, jury, and audience points.

## Local Development

```bash
npm install
npm run import:data
npm run dev
```

Open `http://localhost:5173`. The default room code is `ILOVEDAN`; the default admin PIN is `1234`.

Useful commands:

```bash
npm test
npm run build
```

## Deployment

See `DEPLOYMENT.md` for a complete server walkthrough.

Quick start:

```bash
cp .env.example .env
# Edit .env and set ADMIN_PIN.
docker compose up -d --build
```

Reverse proxy your domain to `127.0.0.1:3000`. A Caddy example is included in `Caddyfile.example`.

Runtime data lives in the Docker volume `eurovision-data`, so rebuilds do not wipe scores.

## Data Refresh

Run this whenever Eurovision publishes updated finalists, running order, YouTube links, bios, or results:

```bash
npm run import:data
```

In production, use the admin tab to run a one-off official result pull or start the best-effort watcher. The watcher polls official Eurovision result pages and broadcasts changes to connected browsers, but manual official score entry remains the dependable fallback for finals night.
