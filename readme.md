# Load Test - Login Service (k6)

## Repository Structure
```
load-test-login/
│
├── data/
│   └── users.csv               # credentials csv (user,passwd)
│
├── scripts/
│   └── loginTest.js            # main k6 script
│
├── results/                    # generated automatically
│   ├── summary.json
│   └── summary.html            # HTML report, open in a browser.
│
├── README.md                   # this file
└── Conclusions.txt             # conclusions after running test
```

---

## Prerequisites

**Recommended versions**
- **k6:** v1.3.0 
- **Windows**: 11 (preffered)

---

## Setup

1. Clone or download this repository.  
2. Ensure your CSV (`data/users.csv`) has this exact structure:
    ```
    user,passwd
    donero,ewedon
    kevinryan,kev02937@
    johnd,m38rmF$
    derek,jklg*_56
    mor_2314,83r5^_
    ```
3. Verify the script file exists at `scripts/loginTest.js`.  
4. Run all commands from the **project root**.

---

## Running the Load Test

### Basic Run + Export JSON Summary
```bash
k6 run scripts/loginTest.js --summary-export=results/summary.json
```

This will execute the test and save results to `results/summary.json` as well as generating the html report.

---

## Guaranteeing 20 TPS

Use the **constant arrival rate** executor in your script to achieve exactly 20 TPS:

```js
export const options = {
  scenarios: {
    steady_20_tps: {
      executor: 'constant-arrival-rate',
      rate: 20,            // iterations per second
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 50, // pre-spawned virtual users
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'], // 95% < 1.5s
    http_req_failed: ['rate<0.03'],    // <3% errors
  },
};
```

If response times are high, increase `preAllocatedVUs` to maintain throughput.

---

## Troubleshooting

| Problem | Cause | Solution |
|----------|--------|-----------|
| `Value is not an object: null` | CSV parsing issue | Remove blank lines; verify `open('data/users.csv')` path |
| Slow test / <20 TPS | Not enough VUs | Increase `preAllocatedVUs` and reduce sleep time |