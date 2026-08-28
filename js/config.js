export const PLAYERS = [
  { id: "76561198038593465", name: "Matei" },
  { id: "76561198078108941", name: "Bozarul" },
  { id: "76561198060030545", name: "Jesus did nothing wrong" },
];

export const LEETIFY_MATCHES_URL =
  "https://api-public.cs-prod.leetify.com/v3/profile/matches";
export const LEETIFY_MATCH_URL =
  "https://api-public.cs-prod.leetify.com/v2/matches";

// This is an intentionally public, read-only Leetify application identifier.
// It only raises the Public API rate limit; it is not an account or write-access secret.
export const LEETIFY_PUBLIC_API_KEY = "a28f2619-cb09-475d-9d7d-47b17a900f7d";

export const SUPABASE_URL = "https://chchllvulagliftmngrw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_bWQ3vJNo4mBUCemzRHrn4g_zabaH7aS";

export const TRACKED_MATCH_SOURCES = ["matchmaking", "matchmaking_competitive"];
export const SEASON_START = "2026-01-21T00:00:00";
export const MAX_MAP_PICKS = 3;
