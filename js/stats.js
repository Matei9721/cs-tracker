export function buildSharedMatches(histories, playerIds, options = {}) {
  if (histories.length !== playerIds.length || histories.length === 0) return [];

  const now = options.now ?? new Date();
  const cutoff = options.cutoff ?? new Date(0);
  const configuredSources =
    options.sources ??
    options.source ??
    ["matchmaking", "matchmaking_competitive"];
  const sources = new Set(
    Array.isArray(configuredSources) ? configuredSources : [configuredSources],
  );
  const historiesById = histories.map(
    (matches) => new Map(matches.map((match) => [match.id, match])),
  );

  return histories[0]
    .filter((match) => {
      const finishedAt = new Date(match.finished_at);
      return (
        sources.has(match.data_source) &&
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

export function formatLeetifyRating(rating) {
  if (rating === null || rating === undefined || rating === "") return "—";
  const rawRating = Number(rating);
  if (!Number.isFinite(rawRating)) return "—";
  const displayedRating = rawRating * 100;
  return `${displayedRating >= 0 ? "+" : ""}${displayedRating.toFixed(2)}`;
}

export function summarizeEpisodicGoats(matches, trackedPlayerIds, minimumGames = 2) {
  const trackedIds = new Set(trackedPlayerIds.map(String));
  const primaryPlayerId = String(trackedPlayerIds[0] ?? "");
  const goatsById = new Map();

  for (const match of matches) {
    const stats = Array.isArray(match.stats) ? match.stats : [];
    const primaryStats = stats.find(
      (playerStats) => String(playerStats.steam64_id) === primaryPlayerId,
    );
    if (!primaryStats) continue;

    const ourTeamNumber = primaryStats.initial_team_number;
    const ourTeam = match.team_scores?.find(
      (team) => team.team_number === ourTeamNumber,
    );
    const theirTeam = match.team_scores?.find(
      (team) => team.team_number !== ourTeamNumber,
    );
    const outcome =
      !ourTeam || !theirTeam
        ? "unknown"
        : ourTeam.score === theirTeam.score
          ? "tie"
          : ourTeam.score > theirTeam.score
            ? "win"
            : "loss";
    const finishedAt = new Date(match.finished_at).getTime();
    const seenInMatch = new Set();

    for (const playerStats of stats) {
      const steam64Id = String(playerStats.steam64_id ?? "");
      if (
        !steam64Id ||
        trackedIds.has(steam64Id) ||
        seenInMatch.has(steam64Id) ||
        playerStats.initial_team_number !== ourTeamNumber
      ) {
        continue;
      }
      seenInMatch.add(steam64Id);

      const existing = goatsById.get(steam64Id) ?? {
        steam64Id,
        name: steam64Id,
        latestNameAt: Number.NEGATIVE_INFINITY,
        games: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        ratingTotal: 0,
        ratingGames: 0,
      };
      const name = String(playerStats.name ?? "").trim();
      if (name && Number.isFinite(finishedAt) && finishedAt >= existing.latestNameAt) {
        existing.name = name;
        existing.latestNameAt = finishedAt;
      }
      existing.games += 1;
      if (outcome === "win") existing.wins += 1;
      if (outcome === "loss") existing.losses += 1;
      if (outcome === "tie") existing.ties += 1;

      const rating = Number(playerStats.leetify_rating);
      if (
        playerStats.leetify_rating !== null &&
        playerStats.leetify_rating !== undefined &&
        playerStats.leetify_rating !== "" &&
        Number.isFinite(rating)
      ) {
        existing.ratingTotal += rating;
        existing.ratingGames += 1;
      }
      goatsById.set(steam64Id, existing);
    }
  }

  return [...goatsById.values()]
    .filter((goat) => goat.games >= minimumGames)
    .map((goat) => {
      const decisiveGames = goat.wins + goat.losses;
      return {
        steam64Id: goat.steam64Id,
        name: goat.name,
        games: goat.games,
        wins: goat.wins,
        losses: goat.losses,
        ties: goat.ties,
        decisiveGames,
        winRate: decisiveGames ? (goat.wins / decisiveGames) * 100 : null,
        ratingGames: goat.ratingGames,
        averageRating: goat.ratingGames ? goat.ratingTotal / goat.ratingGames : null,
      };
    })
    .sort(
      (a, b) =>
        b.games - a.games ||
        (b.winRate ?? Number.NEGATIVE_INFINITY) -
          (a.winRate ?? Number.NEGATIVE_INFINITY) ||
        (b.averageRating ?? Number.NEGATIVE_INFINITY) -
          (a.averageRating ?? Number.NEGATIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    );
}

function percentage(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

export function summarizeMatchMetricLeaders(matches, metric, playerCount = 3) {
  const counts = Array(playerCount).fill(0);
  const totals = Array(playerCount).fill(0);
  const games = Array(playerCount).fill(0);
  let gamesWithLeader = 0;

  for (const match of matches) {
    const values = Array(playerCount).fill(null);

    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const rawValue = match.playerStats?.[playerIndex]?.[metric];
      if (rawValue === null || rawValue === undefined || rawValue === "") continue;
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;

      totals[playerIndex] += value;
      games[playerIndex] += 1;
      values[playerIndex] = value;
    }

    const validValues = values.filter(Number.isFinite);
    if (!validValues.length) continue;
    const leaderValue = Math.max(...validValues);
    values.forEach((value, playerIndex) => {
      if (value === leaderValue) counts[playerIndex] += 1;
    });
    gamesWithLeader += 1;
  }

  const leaderIndex = gamesWithLeader ? counts.indexOf(Math.max(...counts)) : null;
  return {
    counts,
    gamesWithLeader,
    leaderIndex,
    playerSummaries: counts.map((topGames, playerIndex) => ({
      topGames,
      games: games[playerIndex],
      total: games[playerIndex] ? totals[playerIndex] : null,
      average: games[playerIndex] ? totals[playerIndex] / games[playerIndex] : null,
    })),
  };
}

export function aggregatePlayerPerformance(matches, playerCount = 3) {
  return Array.from({ length: playerCount }, (_, playerIndex) => {
    const totals = matches.reduce(
      (sum, match) => {
        const stats = match.playerStats?.[playerIndex];
        if (!stats) return sum;
        sum.kills += Number(stats.total_kills) || 0;
        sum.headshotKills += Number(stats.total_hs_kills) || 0;
        sum.shotsFired += Number(stats.shots_fired) || 0;
        sum.shotsHitFoe += Number(stats.shots_hit_foe) || 0;
        sum.totalDamage += Number(stats.total_damage) || 0;
        sum.rounds += Number(stats.rounds_count) || 0;
        sum.roundsSurvived += Number(stats.rounds_survived) || 0;
        sum.tradeOpportunities += Number(stats.trade_kill_opportunities) || 0;
        sum.tradeAttempts += Number(stats.trade_kill_attempts) || 0;
        const heThrown = Number(stats.he_thrown) || 0;
        const flashbangThrown = Number(stats.flashbang_thrown) || 0;
        sum.utilityThrown +=
          heThrown +
          flashbangThrown +
          (Number(stats.smoke_thrown) || 0) +
          (Number(stats.molotov_thrown) || 0);
        sum.enemyFlashes += Number(stats.flashbang_hit_foe) || 0;
        sum.flashbangThrown += flashbangThrown;
        sum.heFoeDamage += (Number(stats.he_foes_damage_avg) || 0) * heThrown;
        sum.heThrown += heThrown;
        return sum;
      },
      {
        kills: 0,
        headshotKills: 0,
        shotsFired: 0,
        shotsHitFoe: 0,
        totalDamage: 0,
        rounds: 0,
        roundsSurvived: 0,
        tradeOpportunities: 0,
        tradeAttempts: 0,
        utilityThrown: 0,
        enemyFlashes: 0,
        flashbangThrown: 0,
        heFoeDamage: 0,
        heThrown: 0,
      },
    );

    return {
      accuracyPercentage: percentage(totals.shotsHitFoe, totals.shotsFired),
      averageDamagePerRound:
        totals.rounds > 0 ? totals.totalDamage / totals.rounds : null,
      headshotKillPercentage: percentage(totals.headshotKills, totals.kills),
      survivalPercentage: percentage(totals.roundsSurvived, totals.rounds),
      utilityPerRound: totals.rounds > 0 ? totals.utilityThrown / totals.rounds : null,
      enemiesFlashedPerFlashbang:
        totals.flashbangThrown > 0 ? totals.enemyFlashes / totals.flashbangThrown : null,
      averageHeFoeDamage: totals.heThrown > 0 ? totals.heFoeDamage / totals.heThrown : null,
      tradeAttemptPercentage: percentage(totals.tradeAttempts, totals.tradeOpportunities),
    };
  });
}

export function challengeForWinRate(winRate) {
  const rate = Number(winRate);
  if (!Number.isFinite(rate)) {
    return { level: "unknown", canal: false, bike: false };
  }
  if (rate < 50) return { level: "both", canal: true, bike: true };
  if (rate < 66) return { level: "canal", canal: true, bike: false };
  return { level: "clear", canal: false, bike: false };
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

  const playerCount = Math.max(3, matches[0]?.playerStats?.length ?? 0);
  const metricLeaderboards = Object.fromEntries(
    ["leetify_rating", "score", "total_damage"].map((metric) => [
      metric,
      summarizeMatchMetricLeaders(matches, metric, playerCount),
    ]),
  );
  const carryCounts = [...metricLeaderboards.leetify_rating.counts];
  const ratedMatches = metricLeaderboards.leetify_rating.gamesWithLeader;
  const usualCarryIndex = ratedMatches
    ? carryCounts.indexOf(Math.max(...carryCounts))
    : null;
  const ratingSummaries = carryCounts.map((topGames, playerIndex) => {
    const ratings = results
      .map((result) => Number(result.match.playerStats?.[playerIndex]?.leetify_rating))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const middle = Math.floor(ratings.length / 2);
    const median = ratings.length
      ? ratings.length % 2
        ? ratings[middle]
        : (ratings[middle - 1] + ratings[middle]) / 2
      : null;
    return {
      topGames,
      games: ratings.length,
      average: ratings.length
        ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
        : null,
      median,
    };
  });
  const highestAverageIndex = ratingSummaries.some((summary) => summary.average !== null)
    ? ratingSummaries.reduce(
        (bestIndex, summary, index, all) =>
          summary.average !== null &&
          (bestIndex === null || summary.average > all[bestIndex].average)
            ? index
            : bestIndex,
        null,
      )
    : null;
  const playerPerformance = aggregatePlayerPerformance(matches, carryCounts.length);

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
    ratingSummaries,
    highestAverageIndex,
    metricLeaderboards,
    playerPerformance,
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

export function averageGamesPerNight(matches, maxGapHours = 6) {
  if (!matches.length) return 0;
  const timestamps = matches
    .map((match) => new Date(match.finished_at).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!timestamps.length) return 0;

  const maxGapMs = maxGapHours * 60 * 60 * 1000;
  let sessions = 1;
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] - timestamps[index - 1] > maxGapMs) sessions += 1;
  }
  return timestamps.length / sessions;
}
