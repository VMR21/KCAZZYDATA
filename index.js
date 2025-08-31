import express from "express";
import fetch from "node-fetch";
import axios from "axios";
import moment from "moment";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIG ======
const SELF_URL = "https://kcazzydata.onrender.com/leaderboard/top14";
const API_KEY = "9emj7LErCZydUlTRZpHCuiWdn64atsNF";

let cachedData = [];

// ====== CORS (open) ======
app.use(cors());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ====== Helpers ======
function maskUsername(username) {
  if (!username) return "****";
  if (username.length <= 4) return username;
  return username.slice(0, 2) + "***" + username.slice(-2);
}

/**
 * Returns the UTC bounds for the custom period:
 *   start: 5th 00:00:01 UTC
 *   end:   next month 4th 23:59:59 UTC
 *
 * offset = 0 current period
 *        = -1 previous period
 *        = +1 next period
 */
function periodBounds(offset = 0) {
  const now = new Date();

  // Determine which "start month" we’re in
  // If today UTC date is < 5, the current period actually started last month
  let anchorYear = now.getUTCFullYear();
  let anchorMonth = now.getUTCMonth();
  if (now.getUTCDate() < 5) {
    const prev = new Date(Date.UTC(anchorYear, anchorMonth - 1, 1));
    anchorYear = prev.getUTCFullYear();
    anchorMonth = prev.getUTCMonth();
  }

  // Apply offset (each period shifts by 1 month)
  const totalMonths = anchorYear * 12 + anchorMonth + offset;
  const startYear = Math.floor(totalMonths / 12);
  const startMonth = totalMonths % 12;

  // Start: 5th 00:00:01 UTC of startMonth
  const start = new Date(Date.UTC(startYear, startMonth, 5, 0, 0, 1));
  // End: next month 4th 23:59:59 UTC
  const end = new Date(Date.UTC(startYear, startMonth + 1, 4, 23, 59, 59));

  return { start, end };
}

// YYYY-MM-DD for Rainbet API (date-based window; includes whole days)
function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Build Rainbet API URL for CURRENT period
function getDynamicApiUrl() {
  const { start, end } = periodBounds(0);
  const startStr = ymd(start); // 5th
  const endStr = ymd(end);     // 4th of next month
  return `https://services.rainbet.com/v1/external/affiliates?start_at=${startStr}&end_at=${endStr}&key=${API_KEY}`;
}

// ====== Fetch & Cache (Rainbet) ======
async function fetchAndCacheData() {
  try {
    const response = await fetch(getDynamicApiUrl());
    const json = await response.json();
    if (!json?.affiliates) throw new Error("No data");

    const sorted = json.affiliates.sort(
      (a, b) => parseFloat(b.wagered_amount || 0) - parseFloat(a.wagered_amount || 0)
    );

    const top10 = sorted.slice(0, 10);

    // Swap top 2 if you want that visual quirk
    if (top10.length >= 2) {
      [top10[0], top10[1]] = [top10[1], top10[0]];
    }

    cachedData = top10.map((entry) => ({
      username: maskUsername(entry.username),
      wagered: Math.round(parseFloat(entry.wagered_amount || 0)),
      weightedWager: Math.round(parseFloat(entry.wagered_amount || 0)),
    }));

    console.log(`[✅] Leaderboard updated (${new Date().toISOString()})`);
  } catch (err) {
    console.error("[❌] Failed to fetch Rainbet data:", err.message);
  }
}

fetchAndCacheData();
setInterval(fetchAndCacheData, 5 * 60 * 1000); // every 5 minutes

// ====== Routes (Rainbet) ======
app.get("/leaderboard/top14", (req, res) => {
  res.json(cachedData);
});

// Previous full period
app.get("/leaderboard/prev", async (req, res) => {
  try {
    const { start, end } = periodBounds(-1);
    const startStr = ymd(start);
    const endStr = ymd(end);
    const url = `https://services.rainbet.com/v1/external/affiliates?start_at=${startStr}&end_at=${endStr}&key=${API_KEY}`;

    const response = await fetch(url);
    const json = await response.json();
    if (!json?.affiliates) throw new Error("No previous data");

    const sorted = json.affiliates.sort(
      (a, b) => parseFloat(b.wagered_amount || 0) - parseFloat(a.wagered_amount || 0)
    );

    const top10 = sorted.slice(0, 10);
    if (top10.length >= 2) {
      [top10[0], top10[1]] = [top10[1], top10[0]];
    }

    const processed = top10.map((entry) => ({
      username: maskUsername(entry.username),
      wagered: Math.round(parseFloat(entry.wagered_amount || 0)),
      weightedWager: Math.round(parseFloat(entry.wagered_amount || 0)),
    }));

    res.json(processed);
  } catch (err) {
    console.error("[❌] Failed to fetch previous leaderboard:", err.message);
    res.status(500).json({ error: "Failed to fetch previous leaderboard data." });
  }
});

// Optional debug route for period window
app.get("/period", (req, res) => {
  const cur = periodBounds(0);
  const prev = periodBounds(-1);
  const next = periodBounds(1);
  res.json({
    current: { startISO: cur.start.toISOString(), endISO: cur.end.toISOString(), startYMD: ymd(cur.start), endYMD: ymd(cur.end) },
    previous: { startISO: prev.start.toISOString(), endISO: prev.end.toISOString(), startYMD: ymd(prev.start), endYMD: ymd(prev.end) },
    next: { startISO: next.start.toISOString(), endISO: next.end.toISOString(), startYMD: ymd(next.start), endYMD: ymd(next.end) },
  });
});

// Keep-alive self ping (Render)
setInterval(() => {
  fetch(SELF_URL)
    .then(() => console.log(`[🔁] Self-pinged ${SELF_URL}`))
    .catch((err) => console.error("[⚠️] Self-ping failed:", err.message));
}, 270000); // every 4.5 mins

/* ===========================================================
   X.FUN BIWEEKLY + RAW ENDPOINTS (unchanged)
=========================================================== */

const XFUN_CODE = process.env.XFUN_CODE || "Kcaz";
const XFUN_API_KEY = process.env.XFUN_API_KEY || "6e34640f23";
const START_UTC = moment.utc("2025-08-11T00:00:00Z");
const END_UTC   = moment.utc("2025-08-25T00:00:00Z");

const getUsernameXFUN = (row) =>
  row?.name ?? row?.username ?? row?.userName ?? row?.user?.username ?? row?.user ?? "Unknown";

const getWagerXFUN = (row) =>
  Number(row?.wagered ?? row?.betAmount ?? row?.amount ?? row?.stake ?? row?.value ?? 0) || 0;

async function fetchXFUNPage({ startMs, endMs, take = 50, skip = 0 }) {
  const url =
    `https://api.x.fun/api/affiliate/external` +
    `?code=${encodeURIComponent(XFUN_CODE)}` +
    `&gt=${startMs}&lt=${endMs}` +
    `&take=${take}&skip=${skip}`;
  const headers = { "x-apikey": XFUN_API_KEY, "Content-Type": "application/json" };
  const { data } = await axios.get(url, { headers });
  return Array.isArray(data) ? data : (data?.data ?? []);
}

async function fetchXFUNAll({ startMs, endMs, take = 50, maxPages = 200 }) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const chunk = await fetchXFUNPage({ startMs, endMs, take, skip: page * take });
    all.push(...chunk);
    if (chunk.length < take) break;
  }
  return all;
}

function buildLeaderboardXFUN(rows) {
  const totals = new Map();
  for (const r of rows) {
    const user = getUsernameXFUN(r);
    const deposited = Number(r?.deposited ?? 0); // using deposited instead of wagered
    totals.set(user, (totals.get(user) || 0) + deposited);
  }

  let list = Array.from(totals.entries()).map(([username, total]) => ({
    username: maskUsername(username),
    wagered: Number(total.toFixed(2)),        // deposited amount
    weightedWager: Number(total.toFixed(2)),  // same as deposited
  }));

  list.sort((a, b) => b.wagered - a.wagered);

  if (list.length >= 2) {
    [list[0], list[1]] = [list[1], list[0]]; // swap top 2
  }

  return list;
}

async function getBiweeklyRawXFUN() {
  const startMs = START_UTC.unix() * 1000;
  const endMs = END_UTC.unix() * 1000;
  return fetchXFUNAll({ startMs, endMs, take: 50 });
}

async function getBiweeklyLeaderboardXFUN() {
  const raw = await getBiweeklyRawXFUN();
  return buildLeaderboardXFUN(raw);
}

app.get("/raw", async (req, res) => {
  try {
    const raw = await getBiweeklyRawXFUN();
    res.json(raw);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch raw data" });
  }
});

app.get("/leaderboard/biweekly", async (req, res) => {
  try {
    const data = await getBiweeklyLeaderboardXFUN();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Failed to build leaderboard" });
  }
});

/* ===========================================================
   START SERVER
=========================================================== */
app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));
