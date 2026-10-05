#!/usr/bin/env node
// Fetches GitHub traffic stats for every repo you own and merges them into
// docs/data/traffic.json. GitHub only keeps 14 days of traffic, so running this
// daily is what builds up the long-term history.
//
// Env:
//   GH_TOKEN         token with push access to the repos (classic PAT: `repo` scope)
//   INCLUDE_PRIVATE  "true" to also record private repos (their names become public!)
//   INCLUDE_FORKS    "true" to also record forks
//   EXCLUDE_REPOS    comma-separated repo names to skip

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.github.com";
const DATA_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/data/traffic.json");
const CONCURRENCY = 5;

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GH_TOKEN is not set.");
  process.exit(1);
}

const flag = (name) => /^(1|true|yes)$/i.test(process.env[name] ?? "");
const includePrivate = flag("INCLUDE_PRIVATE");
const includeForks = flag("INCLUDE_FORKS");
const exclude = new Set(
  (process.env.EXCLUDE_REPOS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);

async function gh(path) {
  const res = await fetch(API + path, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gh-stats",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} for ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listRepos() {
  const repos = [];
  const visibility = includePrivate ? "all" : "public";
  for (let page = 1; ; page++) {
    const batch = await gh(`/user/repos?affiliation=owner&visibility=${visibility}&per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => (includeForks || !r.fork) && !exclude.has(r.name.toLowerCase()));
}

// Days arrive as { timestamp, count, uniques }; store as { "YYYY-MM-DD": [count, uniques] }.
// Newer values overwrite older ones because the current day is still accumulating.
function mergeDays(existing = {}, days = []) {
  const merged = { ...existing };
  for (const d of days) merged[d.timestamp.slice(0, 10)] = [d.count, d.uniques];
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

async function collectRepo(repo, previous) {
  const base = `/repos/${repo.full_name}`;
  const [views, clones, referrers, paths] = await Promise.all([
    gh(`${base}/traffic/views`),
    gh(`${base}/traffic/clones`),
    gh(`${base}/traffic/popular/referrers`),
    gh(`${base}/traffic/popular/paths`),
  ]);
  return {
    private: repo.private,
    fork: repo.fork,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    views: mergeDays(previous?.views, views.views),
    clones: mergeDays(previous?.clones, clones.clones),
    // These two are rolling 14-day snapshots, not time series; keep only the latest.
    referrers: referrers.map(({ referrer, count, uniques }) => ({ referrer, count, uniques })),
    paths: paths.map(({ path, title, count, uniques }) => ({ path, title, count, uniques })),
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

async function loadExisting() {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return { repos: {} };
    throw err;
  }
}

const data = await loadExisting();
const user = await gh("/user");
const repos = await listRepos();
console.log(`Collecting traffic for ${repos.length} repos owned by ${user.login}`);

let failed = 0;
await mapLimit(repos, CONCURRENCY, async (repo) => {
  try {
    data.repos[repo.name] = await collectRepo(repo, data.repos[repo.name]);
  } catch (err) {
    failed++;
    console.error(`  ${repo.name}: ${err.message}`);
  }
});

// Repos that have been deleted or made private keep their history unless private
// repos are excluded, in which case anything now private is dropped.
if (!includePrivate) {
  for (const [name, r] of Object.entries(data.repos)) if (r.private) delete data.repos[name];
}

data.owner = user.login;
data.updated = new Date().toISOString();
data.repos = Object.fromEntries(Object.entries(data.repos).sort(([a], [b]) => a.localeCompare(b)));

await mkdir(dirname(DATA_FILE), { recursive: true });
await writeFile(DATA_FILE, JSON.stringify({ owner: data.owner, updated: data.updated, repos: data.repos }, null, 1) + "\n");
console.log(`Wrote ${DATA_FILE}${failed ? ` (${failed} repos failed)` : ""}`);
if (failed === repos.length && repos.length > 0) process.exit(1);
