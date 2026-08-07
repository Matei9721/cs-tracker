# Three Stack

A static Counter-Strike 2 dashboard for three friends. It reads live match history from the Leetify Public API, calculates the trio's competitive record since 21 January 2026, visualizes play patterns and carry ratings, and uses Supabase for a shared map ballot.

The site has no application server. It is designed to run entirely on GitHub Pages.

## One-time setup

### 1. Create the voting table

Open the Supabase project, go to **SQL Editor**, paste the contents of [`supabase/setup.sql`](supabase/setup.sql), and run it once. The SQL creates the public read policy and a tightly scoped ballot function. Leetify match data is never stored in Supabase.

Until this SQL is run, the statistics dashboard will work normally and the voting panel will show a setup notice.

### 2. Deploy on GitHub Pages

1. Push the repository to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Push to `main`, or run the **Deploy GitHub Pages** workflow manually.

The publishable Supabase key in `js/config.js` is intentionally safe to ship in a browser. Never put a Supabase `service_role` key in this repository.

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

The tests cover shared-match intersection, the season-start and competitive filters, win-rate handling, Leetify-rating carry calculations, and aggregate statistics.

## Data and privacy

- Match history is requested directly from Leetify when the page opens and is not persisted.
- Votes contain a random browser ID, a nickname chosen by the voter, the selected map, and the current match-cycle ID.
- A new shared competitive match creates a new cycle automatically, so the previous ballot no longer appears.
- Clearing browser storage creates a new anonymous voter identity.

This is an independent community project and is not affiliated with or sponsored by Leetify.
