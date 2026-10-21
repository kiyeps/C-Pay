'use strict';

// Issue #178 — BASELINE evidence.
//
// This harness proves the defect on an unpatched build without depending on
// the fix: it calls the global `fetch` directly, exactly as the relayer's alert
// webhook, `/auth/v1/user` probe, and Supabase REST paths do today. Against a
// peer that accepts the connection and never responds, the call never settles.
//
// A bounded wait is used so the harness itself terminates; the assertion is
// that the request is STILL PENDING when the bound expires, which is the
// vulnerability.

const http = require('http');

const results = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r
        .then(() => results.push(['ok', name]))
        .catch((e) =>
          results.push([
            'not ok',
            name + ' :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e),
          ])
        );
    }
    results.push(['ok', name]);
  } catch (e) {
    results.push([
      'not ok',
      name + ' :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e),
    ]);
  }
  return Promise.resolve();
}

function makeHangingServer() {
  const server = http.createServer((req) => {
    // Accept the request, never respond.
    req.on('data', () => {});
  });
  return server;
}
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

/** Resolves true if `promise` settles within `ms`, false if it is still pending. */
function settlesWithin(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) resolve(false);
    }, ms);
    promise.then(
      () => {
        done = true;
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        done = true;
        clearTimeout(timer);
        resolve(true);
      }
    );
  });
}

async function main() {
  const hanging = makeHangingServer();
  const port = await listen(hanging);

  // ── The vulnerability: an undeadlined fetch never settles ────────────────
  await check('baseline: an undeadlined fetch to a hanging peer never settles', async () => {
    // This is the exact shape of the current call sites: plain fetch, no signal.
    const pending = fetch(`http://127.0.0.1:${port}/hang`, { method: 'POST' }).then(
      (r) => r.text(),
      () => null
    );
    const settled = await settlesWithin(pending, 3000);
    if (settled) {
      throw new Error('request settled within 3s — the defect is not present');
    }
    // Still pending after 3s: the caller is held indefinitely. That is the bug.
  });

  // ── Control: the same endpoint responds normally when it chooses to ──────
  const good = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const goodPort = await listen(good);

  await check('control: a responsive peer settles normally', async () => {
    const res = await fetch(`http://127.0.0.1:${goodPort}/ok`, { method: 'POST' });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (!body.ok) throw new Error('body mismatch');
  });

  await close(hanging);
  await close(good);

  for (const [status, name] of results) console.log(`${status} ${name}`);
  const failed = results.filter((r) => r[0] === 'not ok').length;
  console.log(`SUMMARY ok=${results.length - failed} notok=${failed} total=${results.length}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exitCode = 1;
});
