# Findings

## 2026-10-20 re-run: journey script (k6 v2.3.0)

The single login script was replaced by `scripts/store-journey.js` (login, products, product detail, cart; see the README).

**Correction to the 2025 analysis.** Every `status is 200` check failed in 2025 and the cause was put down to a Cloudflare challenge. A manual `POST /auth/login` in 2026 returns **201 Created** with `{"token": ...}`, and the same request from k6 returns the same. The 2025 check asserted 200, so the 0 of 1,784 result is explained by the status code alone; the Cloudflare explanation was not proven and is probably wrong. The new script asserts 201 and the token in the body.

| Run | Profile | Result |
|---|---|---|
| Smoke x2 | 1 VU, 10 s, 4 iterations each | Green. 0 % failures, all checks passed. Typical p95 per group (ms): login 350-500, products 1,100-1,800, detail 200-700, cart about 300 |
| Load x1 | `constant-arrival-rate` 20 iterations/s, 1 min | **Failed, and fakestoreapi.com degraded.** Achieved 0.51 iterations/s (46 completed, 1,098 dropped), 3.2 req/s instead of about 80 req/s offered. `http_req_failed` 10.4 % (30 of 289; requests hitting the 60 s timeout). p95: login 11.9 s, products 60 s, detail 60 s, cart 60 s. Checks passed 89.6 % |

Reading the load result: the journey sends 4 requests per iteration, so 20 iterations/s is about 80 req/s, far above the 35 req/s the 2025 login-only test reached. The free public API stopped answering within seconds (p95 of 60 s is the k6 request timeout), which looks like throttling or capacity, not a defect in the script: the arrival-rate executor kept starting iterations, used all 100 VUs (`vus_max 100`) and then dropped the rest. Login itself never failed (`login_failed` 0 %), it only got slow. The load run was done once on purpose. The default has since been lowered to 5 journeys/s (20 req/s, `RATE` overrides) and was not re-run against the free API; for higher rates use a target you own.

Stress and spike profiles were not run against fakestoreapi.com. They were validated with `k6 inspect -e PROFILE=...` only.

Other observations: `GET /products` returns the full catalogue and is the slowest group even when the API is healthy, so its p95 threshold is 2,500 ms instead of 1,500 ms. A 10 s run is too short for the web dashboard's default period, so `K6_WEB_DASHBOARD_PERIOD=1s` is set or no report is written.

## 2025 results (original login-only test, 20 VUs ramping)

Full report: [results-report-es.pdf](results-report-es.pdf) (Spanish).

- **Target:** `POST https://fakestoreapi.com/auth/login`, JSON `{ username, password }`, users from `data/users.csv`
- **Scenario:** 20 VUs, ramp-up 10 s, steady 30 s, ramp-down 10 s (about 50 s)

| Metric | Result | Threshold | Outcome |
|---|---|---|---|
| Requests | 1,784 at about 35.6 req/s | | |
| Response time avg / p95 / max | 351.6 / 381.8 / 680 ms | p95 < 1,500 ms | Passed |
| `http_req_failed` | 0 % | < 3 % | Passed |
| `status is 200` check | 0 of 1,784 | | Failed |

The 2025 report blamed the failed checks on a Cloudflare JavaScript challenge. That is superseded by the 2026 correction above: the endpoint returns 201, so a check asserting 200 fails on every request.
