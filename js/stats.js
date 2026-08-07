export function buildSharedMatches(histories, playerIds, options = {}) {
  if (histories.length !== playerIds.length || histories.length === 0) return [];

  const now = options.now ?? new Date();
  const cutoff = options.cutoff ?? new Date(0);
  const source = options.source ?? "matchmaking_competitive";
  const historiesById = histories.map(
    (matches) => new Map(matches.map((match) => [match.id, match])),
  );

  return histories[0]
    .filter((match) => {
      const finishedAt = new Date(match.finished_at);
      return (
        match.data_source === source &&
        finishedAt >= cutoff &&
        finishedAt <= now &&
        historiesById.every((history) => history.has(match.id))
      );
    })
    .map((match) => {
      const appearances = historiesById.map((history) => history.get(match.id));
      const playerStats = appearances.map((appearance, index) =>
        appearance.stats?.find((stat) => stat.steam64_id === playerIds[index]),
      );
      return { ...match, playerStats };
    })
    .filter((match) => match.playerStats.every(Boolean))
    .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));
}

export function resultForMatch(match) {
  const primaryStats = match.playerStats?.[0] ?? match.stats?.[0];
  if (!primaryStats) return { outcome: "unknown", ourScore: 0, theirScore: 0 };

  const ourTeam = match.team_scores?.find(
    (team) => team.team_number === primaryStats.initial_team_number,
  );
  const theirTeam = match.team_scores?.find(
    (team) => team.team_number !== primaryStats.initial_team_number,
  );
  if (!ourTeam || !theirTeam) {
    return { outcome: "unknown", ourScore: 0, theirScore: 0 };
  }

  const outcome =
    ourTeam.score === theirTeam.score
      ? "tie"
      : ourTeam.score > theirTeam.score
        ? "win"
        : "loss";
  return { outcome, ourScore: ourTeam.score, theirScore: theirTeam.score };
}

export function bestRatedPlayerForMatch(match) {
  let bestPlayerIndex = null;
  let bestRating = Number.NEGATIVE_INFINITY;

  for (const [index, stats] of (match.playerStats ?? []).entries()) {
    const rating = Number(stats?.leetify_rating);
    if (Number.isFinite(rating) && rating > bestRating) {
      bestPlayerIndex = index;
      bestRating = rating;
    }
  }

  return bestPlayerIndex === null
    ? { bestPlayerIndex: null, bestRating: null }
    : { bestPlayerIndex, bestRating };
}

export function aggregateMatches(matches) {
  const results = matches.map((match) => ({
    match,
    ...resultForMatch(match),
    ...bestRatedPlayerForMatch(match),
  }));
  const wins = results.filter((result) => result.outcome === "win").length;
  const losses = results.filter((result) => result.outcome === "loss").length;
  const ties = results.filter((result) => result.outcome === "tie").length;
  const decisiveGames = wins + losses;
  const winRate = decisiveGames ? (wins / decisiveGames) * 100 : 0;

  const allStats = matches.flatMap((match) => match.playerStats ?? []);
  const kills = allStats.reduce((sum, stat) => sum + (stat?.total_kills ?? 0), 0);
  const deaths = allStats.reduce((sum, stat) => sum + (stat?.total_deaths ?? 0), 0);

  const mapAccumulator = new Map();
  for (const result of results) {
    const key = result.match.map_name ?? "unknown";
    const entry = mapAccumulator.get(key) ?? { name: key, games: 0, wins: 0, losses: 0, ties: 0 };
    entry.games += 1;
    if (result.outcome === "win") entry.wins += 1;
    if (result.outcome === "loss") entry.losses += 1;
    if (result.outcome === "tie") entry.ties += 1;
    mapAccumulator.set(key, entry);
  }
  const maps = [...mapAccumulator.values()]
    .map((map) => ({
      ...map,
      winRate: map.wins + map.losses ? (map.wins / (map.wins + map.losses)) * 100 : 0,
    }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate);

  let currentStreak = 0;
  let longestWinStreak = 0;
  for (const result of [...results].reverse().filter((item) => item.outcome !== "tie")) {
    if (result.outcome === "win") {
      currentStreak += 1;
      longestWinStreak = Math.max(longestWinStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const carryCounts = Array(Math.max(3, matches[0]?.playerStats?.length ?? 0)).fill(0);
  let ratedMatches = 0;
  for (const result of results) {
    if (result.bestPlayerIndex !== null) {
      carryCounts[result.bestPlayerIndex] += 1;
      ratedMatches += 1;
    }
  }
  const usualCarryIndex = ratedMatches
    ? carryCounts.indexOf(Math.max(...carryCounts))
    : null;

  return {
    total: matches.length,
    wins,
    losses,
    ties,
    decisiveGames,
    winRate,
    kills,
    deaths,
    teamKd: deaths ? kills / deaths : 0,
    maps,
    favoriteMap: maps[0] ?? null,
    longestWinStreak,
    carryCounts,
    ratedMatches,
    usualCarryIndex,
    results,
  };
}

export function formatMapName(rawName = "unknown") {
  return rawName
    .replace(/^(de|cs)_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function activityByDay(matches) {
  const counts = new Map();
  for (const match of matches) {
    const key = dateKey(new Date(match.finished_at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
