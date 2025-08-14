import express from "express";
import fetch from "node-fetch";
import axios from "axios";
import moment from "moment";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;
const SELF_URL = "https://kcazzydata.onrender.com/leaderboard/top14";
const API_KEY = "9emj7LErCZydUlTRZpHCuiWdn64atsNF";

let cachedData = [];

// ✅ CORS headers manually
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

function maskUsername(username) {
  if (username.length <= 4) return username;
  return username.slice(0, 2) + "***" + username.slice(-2);
}

function getDynamicApiUrl() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));

  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  return `https://services.rainbet.com/v1/external/affiliates?start_at=${startStr}&end_at=${endStr}&key=${API_KEY}`;
}

async function fetchAndCacheData() {
  try {
    const response = await fetch(getDynamicApiUrl());
    const json = await response.json();
    if (!json.affiliates) throw new Error("No data");

    const sorted = json.affiliates.sort(
      (a, b) => parseFloat(b.wagered_amount) - parseFloat(a.wagered_amount)
    );

    const top10 = sorted.slice(0, 10);
    if (top10.length >= 2) [top10[0], top10[1]] = [top10[1], top10[0]];

    cachedData = top10.map(entry => ({
      username: maskUsername(entry.username),
      wagered: Math.round(parseFloat(entry.wagered_amount)),
      weightedWager: Math.round(parseFloat(entry.wagered_amount)),
    }));

    console.log(`[✅] Leaderboard updated`);
  } catch (err) {
    console.error("[❌] Failed to fetch Rainbet data:", err.message);
  }
}

fetchAndCacheData();
setInterval(fetchAndCacheData, 5 * 60 * 1000); // every 5 minutes

app.get("/leaderboard/top14", (req, res) => {
  res.json(cachedData);
});

app.get("/leaderboard/prev", async (req, res) => {
  try {
    const now = new Date();
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));

    const startStr = prevMonth.toISOString().slice(0, 10);
    const endStr = prevMonthEnd.toISOString().slice(0, 10);

    const url = `https://services.rainbet.com/v1/external/affiliates?start_at=${startStr}&end_at=${endStr}&key=${API_KEY}`;
    const response = await fetch(url);
    const json = await response.json();

    if (!json.affiliates) throw new Error("No previous data");

    const sorted = json.affiliates.sort(
      (a, b) => parseFloat(b.wagered_amount) - parseFloat(a.wagered_amount)
    );

    const top10 = sorted.slice(0, 10);
    if (top10.length >= 2) [top10[0], top10[1]] = [top10[1], top10[0]]; // swap

    const processed = top10.map(entry => ({
      username: maskUsername(entry.username),
      wagered: Math.round(parseFloat(entry.wagered_amount)),
      weightedWager: Math.round(parseFloat(entry.wagered_amount)),
    }));

    res.json(processed);
  } catch (err) {
    console.error("[❌] Failed to fetch previous leaderboard:", err.message);
    res.status(500).json({ error: "Failed to fetch previous leaderboard data." });
  }
});

setInterval(() => {
  fetch(SELF_URL)
    .then(() => console.log(`[🔁] Self-pinged ${SELF_URL}`))
    .catch(err => console.error("[⚠️] Self-ping failed:", err.message));
}, 270000); // every 4.5 mins


/* ===========================================================
   X.FUN BIWEEKLY + RAW ENDPOINTS
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
    const wager = getWagerXFUN(r);
    totals.set(user, (totals.get(user) || 0) + wager);
  }

  let list = Array.from(totals.entries()).map(([username, total]) => ({
    username: maskUsername(username),
    wagered: Math.round(total),
    weightedWager: Math.round(total),
  }));

  list.sort((a, b) => b.wagered - a.wagered);
  if (list.length >= 2) [list[0], list[1]] = [list[1], list[0]];
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
