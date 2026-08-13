import {
  COMPETITIVE_SOURCE,
  LEETIFY_MATCHES_URL,
  LEETIFY_PUBLIC_API_KEY,
  MAX_MAP_PICKS,
  PLAYERS,
  SEASON_START,
} from "./config.js?v=20260810-leetify-key";
import {
  activityByDay,
  aggregateMatches,
  averageGamesPerNight,
  buildSharedMatches,
  challengeForWinRate,
  dateKey,
  formatLeetifyRating,
  formatMapName,
} from "./stats.js?v=20260810-romanian-forces";
import { getVotes, replaceBallot } from "./supabase.js?v=20260810-carry-metrics";

const $ = (selector) => document.querySelector(selector);
const state = {
  matches: [],
  summary: null,
  cycleMatchId: null,
  votes: [],
  selectedMaps: new Set(),
  voterId: getOrCreateVoterId(),
  liveWinRate: null,
  carryMetric: "leetify_rating",
};

const CHALLENGE_LABELS = {
  clear: {
    title: "Bet cleared",
    note: "66% or higher: nothing to do but keep playing.",
  },
  canal: {
    title: "Canal jump",
    note: "The canal is on. The mapless bike ride stays off.",
  },
  both: {
    title: "Both are on",
    note: "Canal jump plus Amsterdam to Groningen by bike, without maps.",
  },
};

const CARRY_METRICS = {
  leetify_rating: {
    kicker: "Leetify rating",
    description:
      "One point for the highest raw Leetify Rating in each match. Ties count twice. Display values use Leetify's ×100 scale.",
    leaderLabel: "Most top-rated games",
    unavailable: "Leetify ratings were not available",
    contextLabel: "Highest season average",
    contextValue: "average",
  },
  score: {
    kicker: "Score",
    description:
      "One point for the highest Counter-Strike scoreboard score in each match. Ties count twice.",
    leaderLabel: "Most top-score games",
    unavailable: "Score data was not available",
    contextLabel: "Highest average score",
    contextValue: "average",
  },
  total_damage: {
    kicker: "Total damage",
    description:
      "One point for the most total damage in each match. Ties count twice.",
    leaderLabel: "Most damage-leading games",
    unavailable: "Damage data was not available",
    contextLabel: "Highest season damage",
    contextValue: "total",
  },
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
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      _leetify_key: LEETIFY_PUBLIC_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`${player.name}'s Leetify history returned ${response.status}`);
  }
  return response.json();
}

function scoreVerdict(rate, games) {
  if (!games) return "No results yet";
  if (rate > 50) return "Winning so far";
  if (rate === 50) return "Dead even";
  return "Losing so far";
}

function animateWinRate(targetRate) {
  const element = $("#win-rate");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    element.innerHTML = `${targetRate.toFixed(1)}<small>%</small>`;
    return;
  }

  const duration = 1100;
  const startedAt = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    element.innerHTML = `${(targetRate * eased).toFixed(1)}<small>%</small>`;
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderHero(summary) {
  animateWinRate(summary.winRate);
  setText("#score-verdict", scoreVerdict(summary.winRate, summary.decisiveGames));
  setText("#wins", summary.wins);
  setText("#losses", summary.losses);
  setText("#matches-played", summary.total);
  const circumference = 2 * Math.PI * 94;
  requestAnimationFrame(() => {
    $("#ring-value").style.strokeDashoffset =
      circumference * (1 - Math.min(summary.winRate, 100) / 100);
  });
  $("#score-stage").setAttribute("aria-busy", "false");
  setText(
    "#freshness",
    "Live calculation · 2026 season",
  );
}

function setupRevealAnimations() {
  const targets = document.querySelectorAll(
    ".stat-card, .carry-panel, .leaders-panel, .heatmap-panel, .maps-panel, .recent-panel, .challenge-intro, .challenge-simulator, .vote-intro, .ballot",
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  targets.forEach((target) => target.classList.add("reveal-target"));

  if (reducedMotion || !("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  targets.forEach((target) => observer.observe(target));
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

function formatCarryMetric(metric, value) {
  if (!Number.isFinite(value)) return "—";
  if (metric === "leetify_rating") return formatLeetifyRating(value);
  if (metric === "score") return value.toFixed(1);
  return Math.round(value).toLocaleString();
}

function renderCarrySummary(summary) {
  const container = $("#carry-breakdown");
  container.replaceChildren();
  const metric = state.carryMetric;
  const config = CARRY_METRICS[metric];
  const leaderboard = summary.metricLeaderboards?.[metric];
  setText("#carry-kicker", config.kicker);
  setText("#carry-description", config.description);
  setText("#carry-leader-label", config.leaderLabel);

  if (!leaderboard || leaderboard.leaderIndex === null) {
    setText("#carry-leader", "No data");
    setText("#carry-leader-note", config.unavailable);
    setText("#rating-context", "Waiting for enough data to compare ourselves.");
    return;
  }

  const leader = PLAYERS[leaderboard.leaderIndex];
  const leaderSummary = leaderboard.playerSummaries[leaderboard.leaderIndex];
  setText("#carry-leader", leader.name);
  setText(
    "#carry-leader-note",
    `${leaderSummary.topGames} top games · ${formatCarryMetric(metric, leaderSummary.average)} average`,
  );

  const contextKey = config.contextValue;
  const contextIndex = leaderboard.playerSummaries.reduce(
    (bestIndex, playerSummary, index, all) =>
      Number.isFinite(playerSummary[contextKey]) &&
      (bestIndex === null || playerSummary[contextKey] > all[bestIndex][contextKey])
        ? index
        : bestIndex,
    null,
  );
  const contextSummary = leaderboard.playerSummaries[contextIndex];
  setText(
    "#rating-context",
    `${config.contextLabel}: ${PLAYERS[contextIndex].name} (${formatCarryMetric(metric, contextSummary[contextKey])})`,
  );

  const maxCount = Math.max(...leaderboard.counts, 1);
  PLAYERS.forEach((player, index) => {
    const playerSummary = leaderboard.playerSummaries[index];
    const count = playerSummary.topGames;
    const row = document.createElement("div");
    row.className = `carry-row carry-player-${index}`;

    const head = document.createElement("div");
    head.className = "carry-row-head";
    const name = document.createElement("b");
    name.textContent = player.name;
    const value = document.createElement("span");
    value.textContent = `${count} top · ${formatCarryMetric(metric, playerSummary.average)} avg`;
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

function setupCarryMetricSelector() {
  $("#carry-metric").addEventListener("change", (event) => {
    state.carryMetric = event.target.value;
    if (state.summary) renderCarrySummary(state.summary);
  });
}

function formatPercentage(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function renderStatLeaders(summary) {
  const container = $("#leader-metrics");
  container.replaceChildren();

  if (!summary.playerPerformance?.length) {
    const message = document.createElement("div");
    message.className = "metric-loading";
    message.textContent = "No player performance data is available.";
    container.append(message);
    return;
  }

  const metrics = [
    {
      key: "accuracyPercentage",
      label: "Shot accuracy",
      note: "enemy hits / shots fired",
      format: formatPercentage,
    },
    {
      key: "averageDamagePerRound",
      label: "Damage per round",
      note: "total damage / rounds played",
      format: (value) => (Number.isFinite(value) ? value.toFixed(1) : "—"),
    },
    {
      key: "headshotKillPercentage",
      label: "Headshot kill share",
      note: "headshot kills / total kills",
      format: formatPercentage,
    },
    {
      key: "survivalPercentage",
      label: "Rounds survived",
      note: "rounds survived / rounds played",
      format: formatPercentage,
    },
    {
      key: "utilityPerRound",
      label: "Best utility usage",
      note: "grenades thrown / round · flash and HE impact below",
      format: (value) => (Number.isFinite(value) ? value.toFixed(2) : "—"),
      comparison: (player) => {
        const usage = Number.isFinite(player.utilityPerRound)
          ? `${player.utilityPerRound.toFixed(2)}/round`
          : "—";
        const flashes = Number.isFinite(player.enemiesFlashedPerFlashbang)
          ? `${player.enemiesFlashedPerFlashbang.toFixed(2)} enemies/flash`
          : "— enemies/flash";
        const heDamage = Number.isFinite(player.averageHeFoeDamage)
          ? `${player.averageHeFoeDamage.toFixed(1)} HE damage`
          : "— HE damage";
        return `${usage} · ${flashes} · ${heDamage}`;
      },
    },
    {
      key: "tradeAttemptPercentage",
      label: "Trade opportunities attempted",
      note: "attempts / available trade opportunities",
      format: formatPercentage,
    },
  ];

  metrics.forEach((metric, metricIndex) => {
    const values = summary.playerPerformance.map((player) => player[metric.key]);
    const finiteValues = values.filter(Number.isFinite);
    const bestValue = finiteValues.length ? Math.max(...finiteValues) : null;
    const leaderIndices = values
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => Number.isFinite(value) && value === bestValue)
      .map(({ index }) => index);
    const leaderIndex = leaderIndices[0] ?? 0;
    const leaderNames = leaderIndices.map((index) => PLAYERS[index].name).join(" + ");
    const comparisons = PLAYERS.map((player, index) => ({ player, index }))
      .map(({ player, index }) => {
        const detail = metric.comparison
          ? metric.comparison(summary.playerPerformance[index])
          : metric.format(values[index]);
        return `${player.name}: ${detail}`;
      })
      .join(" · ");

    const card = document.createElement("article");
    card.className = `leader-metric leader-player-${leaderIndex}`;
    const top = document.createElement("div");
    top.className = "leader-metric-top";
    const label = document.createElement("p");
    label.textContent = metric.label;
    const badge = document.createElement("span");
    badge.textContent = String(metricIndex + 1).padStart(2, "0");
    top.append(label, badge);
    const value = document.createElement("strong");
    value.textContent = metric.format(bestValue);
    const leader = document.createElement("b");
    leader.className = "leader-name";
    leader.textContent = leaderNames || "No leader yet";
    const note = document.createElement("small");
    note.textContent = metric.note;
    const compare = document.createElement("span");
    compare.className = "leader-comparison";
    compare.textContent = comparisons;
    card.append(top, value, leader, note, compare);
    container.append(card);
  });
}

function updateChallengeDisplay(rate, isLiveRate = false) {
  const challenge = challengeForWinRate(rate);
  const clampedRate = Math.min(Math.max(Number(rate), 0), 100);
  const copy = CHALLENGE_LABELS[challenge.level];
  if (!copy) return;

  setText("#challenge-mode", isLiveRate ? "If the season ended today" : "Testing a finish");
  setText("#challenge-outcome", copy.title);
  setText("#challenge-note", copy.note);
  setText("#challenge-rate-output", `${clampedRate.toFixed(1)}%`);
  $("#rate-marker").style.left = `${clampedRate}%`;

  for (const [selector, active] of [
    ["#canal-challenge", challenge.canal],
    ["#bike-challenge", challenge.bike],
  ]) {
    const card = $(selector);
    card.classList.toggle("is-active", active);
    card.querySelector(".challenge-status").textContent = active ? "On" : "Off";
  }

  const visuals = $("#challenge-visuals");
  visuals.dataset.state = challenge.level;
  visuals.classList.toggle("is-double", challenge.level === "both");
  $("#challenge-clear-visual").hidden = challenge.level !== "clear";
  $("#canal-visual").hidden = !challenge.canal;
  $("#bike-visual").hidden = !challenge.bike;
}

function renderChallengeSimulator(winRate) {
  state.liveWinRate = winRate;
  const slider = $("#challenge-rate");
  slider.value = String(winRate);
  slider.disabled = false;
  $("#use-live-rate").disabled = false;
  updateChallengeDisplay(winRate, true);
  $("#stakes").setAttribute("aria-busy", "false");
}

function setupChallengeSimulator() {
  $("#challenge-rate").addEventListener("input", (event) => {
    updateChallengeDisplay(Number(event.target.value), false);
  });
  $("#use-live-rate").addEventListener("click", () => {
    if (!Number.isFinite(state.liveWinRate)) return;
    $("#challenge-rate").value = String(state.liveWinRate);
    updateChallengeDisplay(state.liveWinRate, true);
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
  setText("#busiest-day", `Most games: ${matches.length ? weekdays[busiestWeekday] : "—"}`);
  setText(
    "#favorite-night",
    `Usually start: ${matches.length ? `${String(busiestHour).padStart(2, "0")}:00` : "—"}`,
  );
  setText(
    "#average-night",
    `Average session: ${matches.length ? `${averageGamesPerNight(matches).toFixed(1)} games` : "—"}`,
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
  for (const result of results.slice(0, 10)) {
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
      rating.textContent = formatLeetifyRating(result.bestRating);
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
    history.textContent = `${map.games} time${map.games === 1 ? "" : "s"} we played it`;
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
    setText("#vote-status", "Three picks max. Deselect one to change your picks.");
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
  setText("#vote-status", "Sending your picks…");
  try {
    await replaceBallot({
      cycleMatchId: state.cycleMatchId,
      voterId: state.voterId,
      voterName,
      maps: [...state.selectedMaps],
    });
    localStorage.setItem("three-stack-voter-name", voterName);
    setText("#vote-status", "Picks saved.");
    await loadVotes();
  } catch (error) {
    setText("#vote-status", `Couldn't save your picks: ${error.message}`);
    button.disabled = false;
  }
}

async function initialize() {
  setupRevealAnimations();
  setupCarryMetricSelector();
  setupChallengeSimulator();
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
        "No shared competitive matches were found in the 2026 season. Check that all three profiles are registered with Leetify and publicly visible.",
      );
    }

    renderHero(state.summary);
    renderSummaryCards(state.summary);
    renderCarrySummary(state.summary);
    renderStatLeaders(state.summary);
    if (state.matches.length) renderChallengeSimulator(state.summary.winRate);
    renderHeatmap(state.matches);
    renderMapBars(state.summary.maps);
    renderRecentMatches(state.summary.results);
    document.body.classList.add("data-ready");

    if (state.matches[0]) {
      const latest = new Date(state.matches[0].finished_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      setText("#vote-cycle", `Votes reset after ${latest}`);
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
