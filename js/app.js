import {
  COMPETITIVE_SOURCE,
  LEETIFY_MATCHES_URL,
  MAX_MAP_PICKS,
  PLAYERS,
  SEASON_START,
} from "./config.js";
import {
  activityByDay,
  aggregateMatches,
  buildSharedMatches,
  dateKey,
  formatMapName,
} from "./stats.js";
import { getVotes, replaceBallot } from "./supabase.js";

const $ = (selector) => document.querySelector(selector);
const state = {
  matches: [],
  summary: null,
  cycleMatchId: null,
  votes: [],
  selectedMaps: new Set(),
  voterId: getOrCreateVoterId(),
};

function getOrCreateVoterId() {
  const key = "three-stack-voter-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function showStatus(message) {
  const banner = $("#status-banner");
  banner.textContent = message;
  banner.hidden = !message;
}

async function fetchMatchHistory(player) {
  const url = new URL(LEETIFY_MATCHES_URL);
  url.searchParams.set("id", player.id);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${player.name}'s Leetify history returned ${response.status}`);
  }
  return response.json();
}

function scoreVerdict(rate, games) {
  if (!games) return "No results yet";
  if (rate > 50) return "Winning record";
  if (rate === 50) return "Even record";
  return "Losing record";
}

function renderHero(summary) {
  const roundedRate = summary.winRate.toFixed(1);
  $("#win-rate").innerHTML = `${roundedRate}<small>%</small>`;
  setText("#score-verdict", scoreVerdict(summary.winRate, summary.decisiveGames));
  setText("#wins", summary.wins);
  setText("#losses", summary.losses);
  setText("#matches-played", summary.total);
  const circumference = 2 * Math.PI * 94;
  $("#ring-value").style.strokeDashoffset =
    circumference * (1 - Math.min(summary.winRate, 100) / 100);
  $("#score-stage").setAttribute("aria-busy", "false");
  setText(
    "#freshness",
    "Live calculation · Since 21 January 2026",
  );
}

function renderSummaryCards(summary) {
  setText("#total-games", summary.total);
  setText("#team-kd", summary.teamKd.toFixed(2));
  setText("#win-streak", summary.longestWinStreak);
  if (summary.favoriteMap) {
    setText("#favorite-map", formatMapName(summary.favoriteMap.name));
    setText(
      "#favorite-map-note",
      `${summary.favoriteMap.games} plays · ${summary.favoriteMap.winRate.toFixed(0)}% win rate`,
    );
  }
}

function renderCarrySummary(summary) {
  const container = $("#carry-breakdown");
  container.replaceChildren();

  if (summary.usualCarryIndex === null) {
    setText("#carry-leader", "No rating data");
    setText("#carry-leader-note", "Leetify ratings were not available");
    return;
  }

  const leader = PLAYERS[summary.usualCarryIndex];
  const leaderCount = summary.carryCounts[summary.usualCarryIndex];
  setText("#carry-leader", leader.name);
  setText(
    "#carry-leader-note",
    `${leaderCount} of ${summary.ratedMatches} games with the highest rating`,
  );

  const maxCount = Math.max(...summary.carryCounts, 1);
  PLAYERS.forEach((player, index) => {
    const count = summary.carryCounts[index] ?? 0;
    const row = document.createElement("div");
    row.className = `carry-row carry-player-${index}`;

    const head = document.createElement("div");
    head.className = "carry-row-head";
    const name = document.createElement("b");
    name.textContent = player.name;
    const value = document.createElement("span");
    value.textContent = `${count} game${count === 1 ? "" : "s"}`;
    head.append(name, value);

    const track = document.createElement("div");
    track.className = "carry-track";
    const fill = document.createElement("div");
    fill.className = "carry-fill";
    fill.style.width = `${(count / maxCount) * 100}%`;
    track.append(fill);
    row.append(head, track);
    container.append(row);
  });
}

function renderHeatmap(matches) {
  const container = $("#heatmap");
  const labels = $("#month-labels");
  container.replaceChildren();
  labels.replaceChildren();

  const counts = activityByDay(matches);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const seasonStart = new Date(SEASON_START);
  const start = new Date(seasonStart);
  start.setDate(start.getDate() - start.getDay());

  const totalDays = Math.ceil((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);
  const compactHeatmap = window.matchMedia("(max-width: 700px)").matches;
  const cellSize = compactHeatmap ? 8 : 10;
  const cellGap = compactHeatmap ? 2 : 3;
  const gridWidth = `${totalWeeks * (cellSize + cellGap) - cellGap}px`;
  container.style.width = gridWidth;
  labels.style.width = gridWidth;
  labels.style.gridTemplateColumns = `repeat(${totalWeeks}, ${cellSize}px)`;

  let previousMonth = -1;
  for (let index = 0; index < totalWeeks * 7; index += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const isInSeason = day >= seasonStart && day <= today;
    const count = isInSeason ? (counts.get(dateKey(day)) ?? 0) : 0;
    const cell = document.createElement("span");
    cell.className = "heat-cell";
    if (!isInSeason) cell.classList.add("outside-season");
    cell.dataset.level = String(Math.min(count, 3));
    cell.title = isInSeason
      ? `${day.toLocaleDateString(undefined, { dateStyle: "medium" })}: ${count} match${count === 1 ? "" : "es"}`
      : "Outside the tracked season";
    container.append(cell);

    if (index % 7 === 0 && day.getMonth() !== previousMonth) {
      const label = document.createElement("span");
      label.textContent = day.toLocaleDateString(undefined, { month: "short" });
      label.style.gridColumn = `${Math.floor(index / 7) + 1} / span 4`;
      labels.append(label);
      previousMonth = day.getMonth();
    }
  }

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekdayCounts = Array(7).fill(0);
  const hourCounts = Array(24).fill(0);
  for (const match of matches) {
    const date = new Date(match.finished_at);
    weekdayCounts[date.getDay()] += 1;
    hourCounts[date.getHours()] += 1;
  }
  const busiestWeekday = weekdayCounts.indexOf(Math.max(...weekdayCounts));
  const busiestHour = hourCounts.indexOf(Math.max(...hourCounts));
  setText("#busiest-day", `Busiest day: ${matches.length ? weekdays[busiestWeekday] : "—"}`);
  setText(
    "#favorite-night",
    `Preferred session: ${matches.length ? `${String(busiestHour).padStart(2, "0")}:00` : "—"}`,
  );
}

function renderMapBars(maps) {
  const container = $("#map-bars");
  container.replaceChildren();
  for (const map of maps.slice(0, 7)) {
    const row = document.createElement("div");
    const decisive = map.wins + map.losses;
    row.className = "map-bar";

    const head = document.createElement("div");
    head.className = "map-bar-head";
    const name = document.createElement("b");
    name.textContent = formatMapName(map.name);
    const value = document.createElement("span");
    value.innerHTML = `<strong>${decisive ? map.winRate.toFixed(0) : "—"}%</strong> / ${map.games}`;
    head.append(name, value);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = `bar-fill${map.winRate < 50 ? " losing" : ""}`;
    fill.style.width = `${decisive ? map.winRate : 0}%`;
    track.append(fill);
    row.append(head, track);
    container.append(row);
  }
}

function renderRecentMatches(results) {
  const body = $("#recent-matches");
  body.replaceChildren();
  for (const result of results.slice(0, 7)) {
    const row = document.createElement("tr");
    const resultCell = document.createElement("td");
    const tag = document.createElement("span");
    tag.className = `result-tag ${result.outcome}`;
    tag.textContent = result.outcome === "win" ? "W" : result.outcome === "loss" ? "L" : "T";
    resultCell.append(tag);

    const mapCell = document.createElement("td");
    mapCell.textContent = formatMapName(result.match.map_name);
    const scoreCell = document.createElement("td");
    scoreCell.textContent = `${result.ourScore} — ${result.theirScore}`;
    const dateCell = document.createElement("td");
    dateCell.textContent = new Date(result.match.finished_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const killsCell = document.createElement("td");
    killsCell.textContent = result.match.playerStats.reduce(
      (sum, stat) => sum + (stat.total_kills ?? 0),
      0,
    );
    const carryCell = document.createElement("td");
    if (result.bestPlayerIndex === null) {
      carryCell.textContent = "—";
    } else {
      const carryName = document.createElement("b");
      carryName.className = "match-carry";
      carryName.textContent = PLAYERS[result.bestPlayerIndex].name;
      const rating = document.createElement("span");
      rating.className = "match-rating";
      rating.textContent = `${result.bestRating >= 0 ? "+" : ""}${result.bestRating.toFixed(3)}`;
      carryCell.append(carryName, rating);
    }
    row.append(resultCell, mapCell, scoreCell, dateCell, killsCell, carryCell);
    body.append(row);
  }
}

function voteCounts() {
  const counts = new Map();
  for (const vote of state.votes) {
    counts.set(vote.map_name, (counts.get(vote.map_name) ?? 0) + 1);
  }
  return counts;
}

function renderBallot() {
  const container = $("#ballot");
  const counts = voteCounts();
  container.replaceChildren();
  container.setAttribute("aria-busy", "false");

  for (const map of state.summary.maps) {
    const label = document.createElement("label");
    label.className = `map-option${state.selectedMaps.has(map.name) ? " selected" : ""}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = map.name;
    input.checked = state.selectedMaps.has(map.name);
    input.addEventListener("change", () => toggleMap(map.name));

    const choice = document.createElement("span");
    choice.className = "map-choice";
    const name = document.createElement("b");
    name.textContent = formatMapName(map.name);
    const history = document.createElement("small");
    history.textContent = `${map.games} trio play${map.games === 1 ? "" : "s"}`;
    choice.append(name, history);

    const tally = document.createElement("span");
    tally.className = "vote-tally";
    const total = document.createElement("strong");
    total.textContent = counts.get(map.name) ?? 0;
    const votes = document.createElement("span");
    votes.textContent = "votes";
    tally.append(total, votes);
    label.append(input, choice, tally);
    container.append(label);
  }
  updateVoteControls();
}

function toggleMap(mapName) {
  if (state.selectedMaps.has(mapName)) {
    state.selectedMaps.delete(mapName);
  } else if (state.selectedMaps.size < MAX_MAP_PICKS) {
    state.selectedMaps.add(mapName);
  } else {
    setText("#vote-status", "Three picks maximum. Deselect one to change your ballot.");
  }
  renderBallot();
}

function updateVoteControls() {
  setText("#pick-count", state.selectedMaps.size);
  const hasName = $("#voter-name").value.trim().length > 0;
  $("#submit-ballot").disabled = !state.cycleMatchId || !hasName;
}

function showBallotError(error) {
  const container = $("#ballot");
  container.replaceChildren();
  const message = document.createElement("div");
  message.className = "ballot-error";
  message.textContent =
    error.status === 404
      ? "Voting needs its one-time Supabase setup. Run supabase/setup.sql in the Supabase SQL Editor; the live stats above already work."
      : "Voting is temporarily unavailable. The match statistics are unaffected.";
  container.append(message);
  container.setAttribute("aria-busy", "false");
}

async function loadVotes() {
  if (!state.cycleMatchId) return;
  try {
    state.votes = await getVotes(state.cycleMatchId);
    state.selectedMaps = new Set(
      state.votes
        .filter((vote) => vote.voter_id === state.voterId)
        .map((vote) => vote.map_name),
    );
    renderBallot();
  } catch (error) {
    showBallotError(error);
  }
}

async function submitBallot() {
  const button = $("#submit-ballot");
  const voterName = $("#voter-name").value.trim();
  if (!voterName || !state.cycleMatchId) return;
  button.disabled = true;
  setText("#vote-status", "Saving ballot…");
  try {
    await replaceBallot({
      cycleMatchId: state.cycleMatchId,
      voterId: state.voterId,
      voterName,
      maps: [...state.selectedMaps],
    });
    localStorage.setItem("three-stack-voter-name", voterName);
    setText("#vote-status", "Ballot saved.");
    await loadVotes();
  } catch (error) {
    setText("#vote-status", `Could not save: ${error.message}`);
    button.disabled = false;
  }
}

async function initialize() {
  $("#voter-name").value = localStorage.getItem("three-stack-voter-name") ?? "";
  $("#voter-name").addEventListener("input", updateVoteControls);
  $("#submit-ballot").addEventListener("click", submitBallot);

  try {
    const histories = await Promise.all(PLAYERS.map(fetchMatchHistory));
    state.matches = buildSharedMatches(
      histories,
      PLAYERS.map((player) => player.id),
      { source: COMPETITIVE_SOURCE, cutoff: new Date(SEASON_START) },
    );
    state.summary = aggregateMatches(state.matches);
    state.cycleMatchId = state.matches[0]?.id ?? null;

    if (!state.matches.length) {
      showStatus(
        "No shared competitive matches were found from 21 January 2026 through today. Check that all three profiles are registered with Leetify and publicly visible.",
      );
    }

    renderHero(state.summary);
    renderSummaryCards(state.summary);
    renderCarrySummary(state.summary);
    renderHeatmap(state.matches);
    renderMapBars(state.summary.maps);
    renderRecentMatches(state.summary.results);

    if (state.matches[0]) {
      const latest = new Date(state.matches[0].finished_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      setText("#vote-cycle", `Round reset after ${latest}`);
      await loadVotes();
      window.setInterval(loadVotes, 30_000);
    } else {
      showBallotError(new Error("No current voting cycle"));
    }
  } catch (error) {
    console.error(error);
    showStatus(
      `Live Leetify data could not be loaded: ${error.message}. No cached or demo result is being shown.`,
    );
    setText("#score-verdict", "Live data unavailable");
    setText("#freshness", "No result calculated");
    $("#score-stage").setAttribute("aria-busy", "false");
    showBallotError(error);
  }
}

initialize();
