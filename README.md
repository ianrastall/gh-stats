# gh-stats

A tiny GitHub Pages dashboard for your repositories' traffic (views, clones, referrers, popular pages).

GitHub only keeps traffic data for 14 days. A scheduled GitHub Action fetches it once a day and merges it into
[`docs/data/traffic.json`](docs/data/traffic.json), so history builds up for as long as the workflow keeps running.
The page in [`docs/`](docs/) is a single static HTML file that reads that JSON. No build step, no dependencies.

## Use it for your own account

1. **Fork** this repo (or copy it) and delete `docs/data/traffic.json` so you start with your own data.
2. **Create a token.** The traffic API needs push access to each repo, which the workflow's built-in token doesn't
   have for your other repos. Either:
   - a classic personal access token with the `repo` scope, or
   - a fine-grained token with **Administration: read** on the repositories you want tracked.
3. **Add it as a secret** named `TRAFFIC_TOKEN` (Settings → Secrets and variables → Actions), or:
   ```bash
   gh secret set TRAFFIC_TOKEN
   ```
4. **Enable Pages:** Settings → Pages → Deploy from a branch → `main` / `/docs`.
5. **Run the workflow once** from the Actions tab ("Collect traffic" → Run workflow). After that it runs daily.

## Options

Set these as repository *variables* (Settings → Secrets and variables → Actions → Variables):

| Variable | Effect |
|---|---|
| `INCLUDE_PRIVATE=true` | Also track private repos. **Their names and traffic become public on the page.** |
| `INCLUDE_FORKS=true` | Also track forks. |
| `EXCLUDE_REPOS=a,b` | Skip these repos. |

## Run locally

```bash
GH_TOKEN=$(gh auth token) node scripts/collect.mjs
python -m http.server --directory docs
```

## Notes

- Days are UTC, as reported by GitHub. The current day is partial until the next run.
- "Unique" numbers are per-day uniques added together; GitHub doesn't expose uniques across longer windows.
- Referrers and popular pages are GitHub's rolling 14-day snapshot, not a time series.
- GitHub pauses scheduled workflows in repos with no activity for 60 days; the daily data commit keeps this one active.
