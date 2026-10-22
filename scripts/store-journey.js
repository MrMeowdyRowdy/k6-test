import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import encoding from 'k6/encoding';

const BASE = __ENV.BASE_URL || 'https://fakestoreapi.com';
const PROFILE = __ENV.PROFILE || 'smoke';

const users = new SharedArray('users', () =>
  open('../data/users.csv')
    .split('\n')
    .slice(1) // skip header
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [user, passwd] = line.trim().split(',');
      return { user, passwd };
    }),
);

const loginDuration = new Trend('login_duration', true);
const loginFailed = new Rate('login_failed');
const productsViewed = new Counter('products_viewed');

// smoke may hit any target; load targets fakestoreapi once; stress and spike are for a target you own.
const profiles = {
  smoke: {
    smoke: { executor: 'constant-vus', vus: 1, duration: '10s' },
  },
  load: {
    load: {
      executor: 'constant-arrival-rate',
      // 5 journeys/s x 4 requests = 20 req/s, the original 20 TPS target
      rate: Number(__ENV.RATE || 5), timeUnit: '1s', duration: '1m',
      preAllocatedVUs: 20, maxVUs: 60,
    },
  },
  stress: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: 10, timeUnit: '1s',
      preAllocatedVUs: 50, maxVUs: 300,
      stages: [
        { target: 20, duration: '20s' },
        { target: 40, duration: '20s' },
        { target: 80, duration: '20s' },
        { target: 120, duration: '20s' },
      ],
    },
  },
  spike: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 5, timeUnit: '1s',
      preAllocatedVUs: 50, maxVUs: 400,
      stages: [
        { target: 5, duration: '15s' },
        { target: 150, duration: '5s' }, // sudden jump
        { target: 150, duration: '20s' },
        { target: 5, duration: '5s' },   // sudden drop
        { target: 5, duration: '15s' },  // recovery
      ],
    },
  },
};

if (!profiles[PROFILE]) {
  throw new Error(`Unknown PROFILE "${PROFILE}"; use one of: ${Object.keys(profiles).join(', ')}`);
}

const latencyThresholds = {
  login_duration: ['p(95)<1500'],
  'http_req_duration{group:::login}': ['p(95)<1500'],
  'http_req_duration{group:::products}': ['p(95)<2500'], // full catalogue payload, slower by design
  'http_req_duration{group:::product_detail}': ['p(95)<1500'],
  'http_req_duration{group:::cart}': ['p(95)<1500'],
};

export const options = {
  scenarios: profiles[PROFILE],
  thresholds: {
    http_req_failed: ['rate<0.03'],
    checks: ['rate>0.97'],
    login_failed: ['rate<0.03'],
    // smoke judges correctness only: a 4-iteration p95 on a third-party API is noise, not an SLO
    ...(PROFILE === 'smoke' ? {} : latencyThresholds),
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };

// The API's token is a JWT whose "sub" is the user id; the cart lookup needs it.
function userIdFromToken(token) {
  try {
    return JSON.parse(encoding.b64decode(token.split('.')[1], 'rawurl', 's')).sub;
  } catch {
    return null;
  }
}

export default function () {
  const u = users[Math.floor(Math.random() * users.length)];
  let token;

  group('login', () => {
    const res = http.post(`${BASE}/auth/login`, JSON.stringify({ username: u.user, password: u.passwd }), json);
    token = res.status === 201 ? res.json('token') : null;
    const ok = check(res, {
      'login status is 201': (r) => r.status === 201,
      'login returns a token': () => typeof token === 'string' && token.length > 0,
    });
    loginFailed.add(!ok);
    loginDuration.add(res.timings.duration);
  });
  if (!token) return; // no session, skip the rest of the journey
  sleep(0.2);

  let products = [];
  group('products', () => {
    const res = http.get(`${BASE}/products`);
    products = res.status === 200 ? res.json() : [];
    check(res, {
      'products status is 200': (r) => r.status === 200,
      'products list is not empty': () => Array.isArray(products) && products.length > 0,
    });
  });
  if (products.length === 0) return;
  sleep(0.3);

  group('product_detail', () => {
    const pick = products[Math.floor(Math.random() * products.length)];
    const res = http.get(`${BASE}/products/${pick.id}`);
    check(res, {
      'product status is 200': (r) => r.status === 200,
      'product has id, title and numeric price': (r) => {
        const p = r.json();
        return p.id === pick.id && typeof p.title === 'string' && typeof p.price === 'number';
      },
    });
    productsViewed.add(1);
  });
  sleep(0.3);

  group('cart', () => {
    const res = http.get(`${BASE}/carts/user/${userIdFromToken(token)}`);
    check(res, {
      'cart status is 200': (r) => r.status === 200,
      'carts are an array': (r) => Array.isArray(r.json()),
    });
  });
}
