import test from "node:test";
import assert from "node:assert/strict";
import { PLAYERS, TRACKED_MATCH_SOURCES } from "../js/config.js";
import {
  aggregateMatches,
  aggregatePlayerPerformance,
  averageGamesPerNight,
  bestRatedPlayerForMatch,
  buildSharedMatches,
  challengeForWinRate,
  formatLeetifyRating,
  formatMapName,
  resultForMatch,
  summarizeEpisodicGoats,
  summarizeMatchMetricLeaders,
} from "../js/stats.js";

const players = ["1", "2", "3"];

test("keeps the configured display names attached to the correct Steam IDs", () => {
  assert.deepEqual(
    PLAYERS.map(({ id, name }) => ({ id, name })),
    [
      { id: "76561198038593465", name: "Matei" },
      { id: "76561198078108941", name: "Bozarul" },
      { id: "76561198060030545", name: "Jesus did nothing wrong" },
    ],
  );
});

function appearance(id, playerId, finishedAt, options = {}) {
  return {
    id,
    finished_at: finishedAt,
    data_source: options.source ?? "matchmaking_competitive",
    map_name: options.map ?? "de_mirage",
    team_scores: options.scores ?? [
      { team_number: 2, score: 13 },
      { team_number: 3, score: 8 },
    ],
    stats: [
      {
        steam64_id: playerId,
        initial_team_number: options.team ?? 2,
        total_kills: options.kills ?? 10,
        total_deaths: options.deaths ?? 10,
        leetify_rating: options.rating ?? 0.01,
      },
    ],
  };
}

test("intersects all three histories and includes Premier and Competitive sources", () => {
  const now = new Date("2026-08-07T12:00:00Z");
  const validDate = "2026-08-01T12:00:00Z";
  const premierDate = "2026-08-02T12:00:00Z";
  const histories = [
    [
      appearance("shared", "1", validDate),
      appearance("premier", "1", premierDate, { source: "matchmaking" }),
      appearance("not-shared", "1", validDate),
      appearance("wingman", "1", validDate, { source: "matchmaking_wingman" }),
      appearance("old", "1", "2025-07-01T12:00:00Z"),
    ],
    [
      appearance("shared", "2", validDate),
      appearance("premier", "2", premierDate, { source: "matchmaking" }),
      appearance("wingman", "2", validDate, { source: "matchmaking_wingman" }),
      appearance("old", "2", "2025-07-01T12:00:00Z"),
    ],
    [
      appearance("shared", "3", validDate),
      appearance("premier", "3", premierDate, { source: "matchmaking" }),
      appearance("wingman", "3", validDate, { source: "matchmaking_wingman" }),
      appearance("old", "3", "2025-07-01T12:00:00Z"),
    ],
  ];

  const matches = buildSharedMatches(histories, players, {
    now,
    cutoff: new Date("2026-01-21T00:00:00Z"),
    sources: TRACKED_MATCH_SOURCES,
  });
  assert.deepEqual(matches.map((match) => match.id), ["premier", "shared"]);
  assert.equal(matches[0].playerStats.length, 3);
});

test("derives the result from the primary player's initial team", () => {
  const match = appearance("m", "1", "2026-08-01T12:00:00Z", {
    team: 3,
    scores: [
      { team_number: 2, score: 13 },
      { team_number: 3, score: 7 },
    ],
  });
  match.playerStats = match.stats;
  assert.deepEqual(resultForMatch(match), {
    outcome: "loss",
    ourScore: 7,
    theirScore: 13,
  });
});

test("excludes ties from the win-rate denominator", () => {
  const makeMatch = (id, scores, map = "de_mirage") => {
    const match = appearance(id, "1", "2026-08-01T12:00:00Z", { scores, map });
    match.playerStats = [
      { ...match.stats[0], leetify_rating: 0.01 },
      { total_kills: 20, total_deaths: 10, leetify_rating: 0.08 },
      { total_kills: 5, total_deaths: 10, leetify_rating: -0.02 },
    ];
    return match;
  };
  const summary = aggregateMatches([
    makeMatch("win", [{ team_number: 2, score: 13 }, { team_number: 3, score: 7 }]),
    makeMatch("loss", [{ team_number: 2, score: 8 }, { team_number: 3, score: 13 }]),
    makeMatch("tie", [{ team_number: 2, score: 12 }, { team_number: 3, score: 12 }]),
  ]);

  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.ties, 1);
  assert.equal(summary.decisiveGames, 2);
  assert.equal(summary.winRate, 50);
  assert.equal(summary.teamKd, 35 / 30);
  assert.deepEqual(summary.carryCounts, [0, 3, 0]);
  assert.equal(summary.usualCarryIndex, 1);
  assert.equal(summary.ratingSummaries[0].average, 0.01);
  assert.equal(summary.ratingSummaries[1].average, 0.08);
  assert.equal(summary.ratingSummaries[2].average, -0.02);
  assert.equal(summary.highestAverageIndex, 1);
});

test("counts Leetify's cs_shelter identifier as Shelter", () => {
  const match = appearance("shelter", "1", "2026-08-06T20:37:34Z", {
    map: "cs_shelter",
  });
  match.playerStats = [
    match.stats[0],
    { total_kills: 10, total_deaths: 10, leetify_rating: 0.02 },
    { total_kills: 10, total_deaths: 10, leetify_rating: 0.03 },
  ];

  assert.deepEqual(aggregateMatches([match]).maps[0], {
    name: "cs_shelter",
    games: 1,
    wins: 1,
    losses: 0,
    ties: 0,
    winRate: 100,
  });
});

test("identifies the player with the highest unmodified Leetify rating", () => {
  const match = {
    playerStats: [
      { leetify_rating: -0.01 },
      { leetify_rating: 0.0342 },
      { leetify_rating: 0.022 },
    ],
  };

  assert.deepEqual(bestRatedPlayerForMatch(match), {
    bestPlayerIndex: 1,
    bestRating: 0.0342,
  });
});

test("ranks per-match leaders by rating, score, or total damage", () => {
  const matches = [
    {
      playerStats: [
        { leetify_rating: 0.03, score: 40, total_damage: 900 },
        { leetify_rating: 0.02, score: 50, total_damage: 1000 },
        { leetify_rating: 0.01, score: 30, total_damage: 800 },
      ],
    },
    {
      playerStats: [
        { leetify_rating: -0.01, score: 45, total_damage: 700 },
        { leetify_rating: 0.01, score: 35, total_damage: 850 },
        { leetify_rating: 0.04, score: 55, total_damage: 1200 },
      ],
    },
  ];

  assert.deepEqual(summarizeMatchMetricLeaders(matches, "leetify_rating").counts, [1, 0, 1]);
  assert.deepEqual(summarizeMatchMetricLeaders(matches, "score").counts, [0, 1, 1]);
  assert.deepEqual(summarizeMatchMetricLeaders(matches, "total_damage").counts, [0, 1, 1]);
});

test("credits every player tied for a match metric lead", () => {
  const summary = summarizeMatchMetricLeaders([
    {
      playerStats: [
        { score: 50 },
        { score: 50 },
        { score: 40 },
      ],
    },
  ], "score");

  assert.deepEqual(summary.counts, [1, 1, 0]);
  assert.equal(summary.gamesWithLeader, 1);
  assert.equal(summary.leaderIndex, 0);
});

test("formats raw Leetify ratings on the website's times-100 display scale", () => {
  assert.equal(formatLeetifyRating(0.0101), "+1.01");
  assert.equal(formatLeetifyRating(-0.0289), "-2.89");
  assert.equal(formatLeetifyRating(0), "+0.00");
  assert.equal(formatLeetifyRating(null), "—");
});

test("finds recurring teammates and summarizes their record with the trio", () => {
  const detailedMatch = (id, finishedAt, scores, friendStats) => ({
    id,
    finished_at: finishedAt,
    team_scores: scores,
    stats: [
      { steam64_id: "1", name: "Matei", initial_team_number: 2 },
      { steam64_id: "2", name: "Bozarul", initial_team_number: 2 },
      { steam64_id: "3", name: "Jesus", initial_team_number: 2 },
      ...friendStats,
      { steam64_id: "enemy", name: "Enemy", initial_team_number: 3, leetify_rating: 0.2 },
    ],
  });
  const matches = [
    detailedMatch(
      "win",
      "2026-08-03T20:00:00Z",
      [{ team_number: 2, score: 13 }, { team_number: 3, score: 8 }],
      [
        { steam64_id: "friend-a", name: "Latest Goat", initial_team_number: 2, leetify_rating: 0.03 },
        { steam64_id: "one-off", name: "One Off", initial_team_number: 2, leetify_rating: 0.1 },
      ],
    ),
    detailedMatch(
      "loss",
      "2026-08-02T20:00:00Z",
      [{ team_number: 2, score: 7 }, { team_number: 3, score: 13 }],
      [{ steam64_id: "friend-a", name: "Old Alias", initial_team_number: 2, leetify_rating: -0.01 }],
    ),
    detailedMatch(
      "tie",
      "2026-08-01T20:00:00Z",
      [{ team_number: 2, score: 12 }, { team_number: 3, score: 12 }],
      [{ steam64_id: "friend-a", name: "Old Alias", initial_team_number: 2, leetify_rating: null }],
    ),
  ];

  const [goat] = summarizeEpisodicGoats(matches, players);
  assert.equal(goat.steam64Id, "friend-a");
  assert.equal(goat.name, "Latest Goat");
  assert.equal(goat.games, 3);
  assert.equal(goat.wins, 1);
  assert.equal(goat.losses, 1);
  assert.equal(goat.ties, 1);
  assert.equal(goat.decisiveGames, 2);
  assert.equal(goat.winRate, 50);
  assert.equal(goat.ratingGames, 2);
  assert.ok(Math.abs(goat.averageRating - 0.01) < Number.EPSILON);
  assert.equal(summarizeEpisodicGoats(matches, players).length, 1);
});

test("requires two games and ignores matches without the primary player's team", () => {
  const matches = [
    {
      finished_at: "2026-08-03T20:00:00Z",
      team_scores: [{ team_number: 2, score: 13 }, { team_number: 3, score: 8 }],
      stats: [
        { steam64_id: "1", initial_team_number: 2 },
        { steam64_id: "friend", name: "Friend", initial_team_number: 2, leetify_rating: 0 },
      ],
    },
    {
      finished_at: "2026-08-02T20:00:00Z",
      team_scores: [{ team_number: 2, score: 13 }, { team_number: 3, score: 8 }],
      stats: [{ steam64_id: "friend", name: "Friend", initial_team_number: 2, leetify_rating: 0.1 }],
    },
  ];

  assert.deepEqual(summarizeEpisodicGoats(matches, players), []);
  assert.equal(summarizeEpisodicGoats(matches, players, 1)[0].averageRating, 0);
});

test("aggregates the trio's derived performance metrics", () => {
  const performance = aggregatePlayerPerformance([
    {
      playerStats: [
        {
          total_kills: 10,
          total_hs_kills: 3,
          shots_fired: 100,
          shots_hit_foe: 20,
          total_damage: 800,
          rounds_count: 10,
          rounds_survived: 3,
          trade_kill_opportunities: 10,
          trade_kill_attempts: 8,
        },
        {
          total_kills: 8,
          total_hs_kills: 4,
          shots_fired: 80,
          shots_hit_foe: 24,
          total_damage: 900,
          rounds_count: 10,
          rounds_survived: 4,
          trade_kill_opportunities: 10,
          trade_kill_attempts: 9,
          he_thrown: 2,
          he_foes_damage_avg: 30,
          molotov_thrown: 1,
          smoke_thrown: 3,
          flashbang_thrown: 4,
          flashbang_hit_foe: 6,
        },
        {
          total_kills: 5,
          total_hs_kills: 2,
          shots_fired: 50,
          shots_hit_foe: 5,
          total_damage: 700,
          rounds_count: 10,
          rounds_survived: 2,
          trade_kill_opportunities: 10,
          trade_kill_attempts: 7,
        },
      ],
    },
  ]);

  assert.equal(performance[1].headshotKillPercentage, 50);
  assert.equal(performance[1].accuracyPercentage, 30);
  assert.equal(performance[1].averageDamagePerRound, 90);
  assert.equal(performance[1].survivalPercentage, 40);
  assert.equal(performance[1].utilityPerRound, 1);
  assert.equal(performance[1].enemiesFlashedPerFlashbang, 1.5);
  assert.equal(performance[1].averageHeFoeDamage, 30);
  assert.equal(performance[1].tradeAttemptPercentage, 90);
});

test("applies the challenge thresholds exactly", () => {
  assert.deepEqual(challengeForWinRate(66), { level: "clear", canal: false, bike: false });
  assert.deepEqual(challengeForWinRate(65.9), { level: "canal", canal: true, bike: false });
  assert.deepEqual(challengeForWinRate(50), { level: "canal", canal: true, bike: false });
  assert.deepEqual(challengeForWinRate(49.9), { level: "both", canal: true, bike: true });
});

test("calculates average games per playing session across midnight", () => {
  const matches = [
    { finished_at: "2026-08-01T22:00:00Z" },
    { finished_at: "2026-08-01T23:30:00Z" },
    { finished_at: "2026-08-02T01:00:00Z" },
    { finished_at: "2026-08-03T18:00:00Z" },
    { finished_at: "2026-08-03T19:30:00Z" },
    { finished_at: "2026-08-03T21:00:00Z" },
  ];
  assert.equal(averageGamesPerNight(matches), 3);
  assert.equal(averageGamesPerNight([]), 0);
});

test("formats Leetify map identifiers for display", () => {
  assert.equal(formatMapName("de_dust2"), "Dust2");
  assert.equal(formatMapName("cs_office"), "Office");
});
