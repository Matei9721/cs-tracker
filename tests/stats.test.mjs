import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateMatches,
  bestRatedPlayerForMatch,
  buildSharedMatches,
  formatMapName,
  resultForMatch,
} from "../js/stats.js";

const players = ["1", "2", "3"];

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

test("intersects all three histories and applies source and season-start filters", () => {
  const now = new Date("2026-08-07T12:00:00Z");
  const validDate = "2026-08-01T12:00:00Z";
  const histories = [
    [
      appearance("shared", "1", validDate),
      appearance("not-shared", "1", validDate),
      appearance("wingman", "1", validDate, { source: "matchmaking_wingman" }),
      appearance("old", "1", "2025-07-01T12:00:00Z"),
    ],
    [appearance("shared", "2", validDate), appearance("wingman", "2", validDate, { source: "matchmaking_wingman" }), appearance("old", "2", "2025-07-01T12:00:00Z")],
    [appearance("shared", "3", validDate), appearance("wingman", "3", validDate, { source: "matchmaking_wingman" }), appearance("old", "3", "2025-07-01T12:00:00Z")],
  ];

  const matches = buildSharedMatches(histories, players, {
    now,
    cutoff: new Date("2026-01-21T00:00:00Z"),
  });
  assert.deepEqual(matches.map((match) => match.id), ["shared"]);
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

test("formats Leetify map identifiers for display", () => {
  assert.equal(formatMapName("de_dust2"), "Dust2");
  assert.equal(formatMapName("cs_office"), "Office");
});
