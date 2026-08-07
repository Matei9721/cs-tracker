# Project requirements

## Product goal

Build and maintain a simple, visually distinctive Counter-Strike 2 dashboard for the three configured Steam accounts. The primary product moment is their shared competitive win rate for the current tracked season, which begins on 21 January 2026. Secondary sections show useful shared-game statistics and let visitors vote for up to three maps to play next.

## Hosting and architecture

- The production site must remain a static site hosted for free on GitHub Pages.
- Do not add an application backend, server-rendered runtime, paid service, or required scheduled data scraper.
- Fetch current Leetify data directly in the browser. The public endpoint currently supports browser CORS.
- Use Supabase only for shared map-vote persistence.
- A Supabase publishable/anonymous key may be present in client code. Never commit a `service_role` key, database password, Leetify private API key, or other secret.
- Keep GitHub Pages deployment in `.github/workflows/pages.yml`.

## Players and match rules

- Primary player Steam64 ID: `76561198038593465`.
- Friend Steam64 IDs: `76561198060030545` and `76561198078108941`.
- Display names: `Matei`, `BMO`, and `Jesus did nothing wrong`. Do not label the primary player as `You` or infer labels from changing Steam aliases.
- A shared game is a Leetify match whose match ID appears in all three players' histories.
- Include only `matchmaking_competitive` games finished on or after 21 January 2026 and no later than the visitor's current time.
- Determine the trio's result from the primary player's `initial_team_number` and `team_scores`.
- Win rate is `wins / (wins + losses)`. Ties are excluded from both numerator and denominator, while they may be shown separately for transparency.
- Use each player's unmodified `leetify_rating` to identify the highest-rated member of the trio in each game and summarize who most often has the highest rating.
- Do not cache or store Leetify match payloads. Re-fetch them when the page loads.

## Map voting

- A voter may select zero to three distinct maps, never more than three.
- The voting cycle is the latest qualifying shared match ID.
- When a newer qualifying shared match appears, the UI must automatically show a fresh ballot; old rows may remain in Supabase but must not be counted.
- Keep write access behind the `replace_map_ballot` Supabase RPC in `supabase/setup.sql`. Do not open direct anonymous insert, update, or delete policies on the table.
- Anonymous voter identity and nickname may be stored locally in the browser. Do not introduce accounts unless explicitly requested.
- If Supabase is not initialized or temporarily unavailable, shared statistics must still work and the voting section must explain the problem without breaking the page.

## Leetify attribution

- State that the site is an independent community project, not affiliated with or sponsored by Leetify.
- Show a legible `Data Provided by Leetify` link back to `https://leetify.com/`.
- Include `View on Leetify` links near match data where practical.
- Do not rename, rescale, or otherwise misrepresent Leetify-provided metrics.

## Quality bar

- Preserve responsive behavior, keyboard access, visible focus states, readable contrast, and reduced-motion support.
- Always use the in-app Browser to visually validate website changes at desktop and mobile sizes before completion.
- Keep core match calculations in pure functions under `js/stats.js` and maintain their tests.
- Run `npm test` after changing filters or calculations.
- Never present demo values as live data. Loading, empty, privacy-restricted, and network-error states must be explicit.
