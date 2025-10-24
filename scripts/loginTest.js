import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

// Load CSV users
const users = new SharedArray('users', function () {
  return open('../data/users.csv')
    .split('\n')
    .slice(1) // skip header
    .filter(line => line.trim() !== '') // avoid blank lines
    .map(line => {
      const [user, passwd] = line.trim().split(',');
      return { user, passwd };
    });
});

export const options = {
  stages: [
    { duration: '10s', target: 20 }, // ramp up
    { duration: '30s', target: 20 }, // steady 20 VUs
    { duration: '10s', target: 0 },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1500'], // 95% of responses < 1.5s
    http_req_failed: ['rate<0.03'],    // <3% errors
  },
};

export default function () {
  const randomUser = users[Math.floor(Math.random() * users.length)];

  const url = 'https://fakestoreapi.com/auth/login';
  const payload = JSON.stringify({
    username: randomUser.user,
    password: randomUser.passwd,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post(url, payload, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time OK': (r) => r.timings.duration < 1500,
  });

  sleep(0.1);
}

// Automatically generate HTML report when the test finishes
export function handleSummary(data) {
  return {
    'results/summary.html': htmlReport(data),
  };
}
