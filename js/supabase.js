import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

const headers = {
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
  "Content-Type": "application/json",
};

async function parseResponse(response) {
  if (response.ok) {
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  let message = `Supabase request failed (${response.status})`;
  try {
    const body = await response.json();
    message = body.message ?? body.hint ?? message;
  } catch {
    // Preserve the useful status-based fallback.
  }
  const error = new Error(message);
  error.status = response.status;
  throw error;
}

export async function getVotes(cycleMatchId) {
  const query = new URLSearchParams({
    select: "map_name,voter_id,voter_name",
    cycle_match_id: `eq.${cycleMatchId}`,
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/map_votes?${query}`, {
    headers,
  });
  return parseResponse(response);
}

export async function replaceBallot({ cycleMatchId, voterId, voterName, maps }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/replace_map_ballot`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_cycle_match_id: cycleMatchId,
      p_voter_id: voterId,
      p_voter_name: voterName,
      p_maps: maps,
    }),
  });
  return parseResponse(response);
}
