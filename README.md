# k6-test

Performance test of the [fakestoreapi.com](https://fakestoreapi.com) shopper journey, written with k6: one script, four load profiles.

[![k6](https://github.com/MrMeowdyRowdy/k6-test/actions/workflows/k6.yml/badge.svg)](https://github.com/MrMeowdyRowdy/k6-test/actions/workflows/k6.yml)
[Latest report](https://mrmeowdyrowdy.github.io/k6-test/)

## What it tests

One iteration is one shopper, each step in its own `group` so latency is reported per step:

| Group | Request | Checks |
|---|---|---|
| `login` | `POST /auth/login` with a random user from `data/users.csv` | status 201, token in body |
| `products` | `GET /products` | status 200, non-empty array |
| `product_detail` | `GET /products/{id}` for a random product | status 200, `id` matches, `title` string, `price` number |
| `cart` | `GET /carts/user/{id}`, id read from the token's `sub` | status 200, every cart's `userId` matches |

If login fails or the product list comes back empty, the iteration stops. Think time between steps is 0.2 to 0.3 s.

Profiles, picked with `PROFILE` (default `smoke`):

| Profile | Executor | Shape | Duration | Where it may run |
|---|---|---|---|---|
| `smoke` | `constant-vus` | 1 VU | 10 s | anywhere, including CI |
| `load` | `constant-arrival-rate` | 5 journeys/s = 20 req/s (`RATE` overrides), 20 VUs pre-allocated, max 60 | 1 min | fakestoreapi.com once in a while |
| `stress` | `ramping-arrival-rate` | ramps 10 → 20 → 40 → 80 → 120 iterations/s, 20 s per stage | 80 s | a target you own |
| `spike` | `ramping-arrival-rate` | 5 for 15 s, jump to 150 in 5 s, hold 20 s, drop to 5, recover 15 s | 60 s | a target you own |

fakestoreapi.com is a free public API. CI and everyday runs use smoke only. `stress` and `spike` were never run against it; they were only checked with `k6 inspect` and are meant for a service you control.

## Design choices

- **Arrival rate, not VUs.** With a VU model the request rate falls when the server slows down, which hides the problem. Arrival-rate executors start iterations at a fixed rate whatever the latency, so a slow server shows up as latency, `dropped_iterations` and timeouts. It also fixes the offered load: each journey makes 4 requests, so the default 5 journeys/s is 20 req/s, the original 20 TPS target.
- **Thresholds in the script**, so a miss gives a non-zero exit code: `http_req_failed` < 3 %, `checks` > 97 %, `login_failed` < 3 %, p95 < 1.5 s for login, product detail and cart, p95 < 2.5 s for `products` (full catalogue payload). Per-group limits use tags, for example `http_req_duration{group:::login}`. None aborts a run early; they judge at the end. The latency limits apply to `load`, `stress` and `spike` only: `smoke` (the CI run) judges correctness (failures, checks, login), because a p95 over about six iterations of a free third-party API is noise and would turn the badge red for reasons outside this repo.
- **Custom metrics**: `login_duration` (Trend), `login_failed` (Rate), `products_viewed` (Counter, successful detail views).
- **No remote imports.** The old version imported `k6-reporter` from the unpinned `main` branch of a GitHub repo, which is a supply-chain risk. Reports now come from k6's built-in web dashboard export, with `--summary-export` for the JSON.
- **Credentials in a CSV** read once through `SharedArray`; the file holds the public demo users of the API.
- **CI is smoke-only** to stay polite to a free service and to keep the pipeline stable.

```
data/users.csv               # demo users (user,passwd)
scripts/store-journey.js     # the k6 script, all profiles
docs/findings.md             # results and analysis
docs/results-report-es.pdf   # original 2025 results report (Spanish, PDF)
results/                     # generated, not committed
```

## Run it

Prerequisite: [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) (tested with v2.3.0). From the repository root:

```bash
mkdir -p results
export K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_PERIOD=1s K6_WEB_DASHBOARD_EXPORT=results/report.html
k6 run --summary-export results/summary.json scripts/store-journey.js                 # smoke
PROFILE=load k6 run --summary-export results/summary.json scripts/store-journey.js    # load
k6 inspect -e PROFILE=stress scripts/store-journey.js                                  # check a profile parses
```

Open `results/report.html` in a browser. `BASE_URL` points the script at another target (default `https://fakestoreapi.com`). Without `K6_WEB_DASHBOARD_PERIOD=1s` the dashboard skips the report on a 10 s run.

## CI

`.github/workflows/k6.yml` runs on push and pull request to `main`, nightly at 05:00 UTC, and on demand. It installs k6 with `grafana/setup-k6-action`, runs the smoke profile, and always uploads `results/` as the `k6-results` artifact. On `main` a second job publishes the report to GitHub Pages as `index.html`: [mrmeowdyrowdy.github.io/k6-test](https://mrmeowdyrowdy.github.io/k6-test/).

## Findings

Full analysis in [docs/findings.md](docs/findings.md). Original 2025 report: [Spanish, PDF](docs/results-report-es.pdf).

- **2026-10-20, smoke (2 runs):** green, 0 % failures, all checks passed. `GET /products` is the slowest step (p95 about 1.1 to 1.8 s) because it returns the whole catalogue.
- **2026-10-20, load (1 run, 20 iterations/s):** the API could not follow. 0.51 iterations/s achieved, 1,098 iterations dropped, 10.4 % request failures (60 s timeouts), p95 login 11.9 s and 60 s for the other steps. 20 iterations/s is about 80 req/s here, which this free service does not sustain; login never failed, it only slowed down. The default is now 5 journeys/s (20 req/s, the original target); it was not re-run against the free API.
- **2025, login only, 20 VUs:** 1,784 requests at about 35 req/s, p95 381.8 ms, 0 % HTTP failures, but every `status is 200` check failed. That was blamed on a Cloudflare challenge; in 2026 the endpoint answers **201**, so the status check was the likely cause. The new script asserts 201 and the token.
