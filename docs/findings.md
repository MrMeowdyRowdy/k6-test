# Findings

## 2026-10-20 re-run: journey script (k6 v2.3.0)

The single login script was replaced by `scripts/store-journey.js` (login, products, product detail, cart; see the README).

**Correction to the 2025 analysis.** Every `status is 200` check failed in 2025 and the cause was put down to a Cloudflare challenge. A manual `POST /auth/login` in 2026 returns **201 Created** with `{"token": ...}`, and the same request from k6 returns the same. The 2025 check asserted 200, so the 0 of 1,784 result is explained by the status code alone; the Cloudflare explanation was not proven and is probably wrong. The new script asserts 201 and the token in the body.

| Run | Profile | Result |
|---|---|---|
| Smoke x2 | 1 VU, 10 s, 4 iterations each | Green. 0 % failures, all checks passed. p95 per group (second run, ms): see `results/` after a run; typical login 350-500, products 1,100-1,800, detail 200-700, cart about 300 |
| Load x1 | `constant-arrival-rate` 20 iterations/s, 1 min | **Failed, and fakestoreapi.com degraded.** Achieved 0.51 iterations/s (46 completed, 1,098 dropped), 3.2 req/s instead of about 80 req/s offered. `http_req_failed` 10.4 % (30 of 289; requests hitting the 60 s timeout). p95: login 11.9 s, products 60 s, detail 60 s, cart 60 s. Checks passed 89.6 % |

Reading the load result: the journey sends 4 requests per iteration, so 20 iterations/s is about 80 req/s, far above the 35 req/s the 2025 login-only test reached. The free public API stopped answering within seconds (p95 of 60 s is the k6 request timeout), which looks like throttling or capacity, not a defect in the script: the arrival-rate executor kept starting iterations, used all 100 VUs (`vus_max 100`) and then dropped the rest. Login itself never failed (`login_failed` 0 %), it only got slow. The load run was done once on purpose; rerun it against a target you own, or lower the rate with `RATE=5`.

Stress and spike profiles were not run against fakestoreapi.com. They were validated with `k6 inspect -e PROFILE=...` only.

Other observations: `GET /products` returns the full catalogue and is the slowest group even when the API is healthy, so its p95 threshold is 2,500 ms instead of 1,500 ms. A 10 s run is too short for the web dashboard's default period, so `K6_WEB_DASHBOARD_PERIOD=1s` is set or no report is written.

## 2025 results (original login-only test, 20 VUs ramping)

## Test Overview
- **Target Endpoint:** `https://fakestoreapi.com/auth/login`
- **Scenario:** 20 VUs (ramp-up 10s → steady 30s → ramp-down 10s)
- **Total Iterations:** 1,784  
- **Throughput:** ~35.6 requests/sec (≈35 TPS)
- **Duration:** ~50 seconds total
- **Users Source:** `data/users.csv` (5 valid credentials)
- **Payload:** JSON `{ username, password }`

---

## Performance Summary

| Metric | Result | Interpretation |
|---------|---------|----------------|
| **Average Response Time** | **351.6 ms** | Excellent — far below 1.5 s SLA. |
| **95th Percentile (p95)** | **381.8 ms** | Stable latency under consistent load. |
| **Maximum Response Time** | **680 ms** | Acceptable peak response; no abnormal spikes. |
| **Average Iteration Duration** | **453.8 ms** | Consistent execution time across VUs. |

**Latency threshold (`p(95) < 1500ms`) comfortably met.**

---

## Throughput

- **Total HTTP Requests:** 1,784  
- **Request Rate:** ~35.6 req/s (≈35 TPS)

**Target of 20 TPS achieved and exceeded by ~78%.**

---

## Reliability and Error Analysis

| Metric | Observed | Threshold | Result |
|---------|-----------|------------|--------|
| **HTTP Failures (`http_req_failed`)** | **0%** | `< 3%` | Passed |
| **Response Time < 1.5 s** | **100% of requests** | `≥ 97%` | Passed |
| **Status 200 Check** | **0/1784 passed** | — | Blocked by Cloudflare challenge page |

> Although valid credentials were used, the login endpoint is protected by **Cloudflare’s JavaScript and cookie challenge**.  
> Because k6 does not execute JavaScript or manage cookies like a browser, all requests were intercepted by Cloudflare’s bot protection layer and never reached the actual API.  
> This resulted in all `status is 200` checks failing, despite successful request delivery and consistent response times.

---

## Key Observations

1. **Cloudflare protection interfered** with functional login testing, returning “Enable JavaScript and cookies” responses instead of real API results.  
2. **Performance layer remained stable** — latency, throughput, and network timings are valid and consistent.  
3. **Infrastructure handled load efficiently** (≈35 TPS, no timeouts or network failures).  
4. **Thresholds for latency and reliability met**, confirming that transport performance (network + TLS + server responsiveness) is strong.

---

## Threshold Summary

| Threshold | Target | Result | Outcome |
|------------|----------|----------|----------|
| `p(95) < 1500 ms` | < 1.5 s | 381.8 ms | Passed |
| `http_req_failed < 0.03` | < 3% | 0% | Passed |

---

## Summary

| Category | Result |
|-----------|---------|
| **Latency** | Excellent |
| **Throughput** | Above target |
| **Error Rate** | 0% |
| **Functional 200 Responses** | Blocked by Cloudflare |
| **Overall System Performance** | Meets performance thresholds (network layer) |

---

**Conclusion:**  
> The system demonstrated stable performance and low latency under a 20 TPS load.  
> However, Cloudflare’s bot protection prevented valid login requests from being processed by the backend API.  
> Once the Cloudflare challenge is bypassed or temporarily disabled for testing, the same script can accurately validate both performance and functional correctness.
