# Romanian CS Forces

A static Counter-Strike 2 dashboard for three Romanian friends. It reads live match history from the Leetify Public API, preserves shared season statistics in Supabase, visualizes play patterns and carry ratings, and offers a shared map ballot.

The site has no application server. It is designed to run entirely on GitHub Pages.

## One-time setup

### 1. Create the voting table

Open the Supabase project, go to **SQL Editor**, paste the contents of [`supabase/setup.sql`](supabase/setup.sql), and run it once. The SQL creates the public read policy and a tightly scoped ballot function.

Until this SQL is run, the statistics dashboard will work normally and the voting panel will show a setup notice.

### 2. Create the season archive

Run [`supabase/season-archive.sql`](supabase/season-archive.sql) in the same SQL Editor. This creates the archive and its read/save RPCs. Direct anonymous table writes remain disabled. `archive_season_matches` validates IDs, player membership, scores, season dates, sources, and numeric statistics. It inserts new IDs only, so retries and concurrent visitors cannot duplicate or overwrite a game. The browser supplies these statistics; the database does not independently verify them with Leetify.

Each load starts the archive read alongside the three Leetify history requests, then merges by match ID and renders once. New games are saved after rendering, without extra Leetify calls. Supabase errors leave the current live histories usable with an explicit partial-season warning. The archive request has a five-second timeout; this parallel request can still affect loading on a slow or unavailable connection.

Capturing depends on visits: a page must be loaded before a shared game disappears from any player's 100-game history. Already-missing games require a separate backfill. `season_archive_status.coverage_complete` stays false until the full season has been recovered; set it true only after confirming that backfill. Current Leetify appearances override archived statistics on screen, but an administrator must apply any permanent corrections to archived rows.

No Edge Function, service-role browser key, scheduled scraper, or new backend is required.

### 3. Deploy on GitHub Pages

1. Push the repository to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Push to `main`, or run the **Deploy GitHub Pages** workflow manually.

The publishable Supabase key and Leetify Public API key in `js/config.js` are intentionally safe to ship in a browser. The Leetify key is a read-only application identifier that raises the Public API rate limit; it does not grant account or write access. Never put a Supabase `service_role` key, database password, or other privileged secret in this repository.

## Local preview

Any static file server works. For example:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Validation

```powershell
npm test
```

The tests cover shared-match intersection, the season-start and Premier/Competitive source filters, win-rate handling, Leetify-rating carry calculations, and aggregate statistics.

## Data and privacy

- Current histories are fetched directly from Leetify on every load. Only compact shared-match statistics are archived; raw API responses and account credentials are not stored.
- Votes contain a random browser ID, a nickname chosen by the voter, the selected map, and the current match-cycle ID.
- A new shared Premier or Competitive match creates a new cycle automatically, so the previous ballot no longer appears.
- Clearing browser storage creates a new anonymous voter identity.

This is an independent community project and is not affiliated with or sponsored by Leetify.
