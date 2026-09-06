// Build the web bundle used by the password-recovery smoke suite.
//
// This is deliberately NOT scripts/build-local.mjs (what test:prod-smoke uses):
// that build DELETES VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY to enable local
// mode, so the reset screen there renders "Cloud accounts are not configured in
// this build" and every recovery assertion would pass without the gate ever
// being exercised. Supabase has to be configured for these tests to mean
// anything.
//
// The Supabase URL points at the suite's OWN static server. Nothing real is
// contacted: the two auth endpoints the flow uses are fulfilled by Playwright
// route handlers, and anything else 404s locally and immediately instead of
// hanging on DNS for an unroutable host. It also keeps auth requests
// same-origin, so no CORS preflight stands between the test and the assertion.
//
// The port is shared with playwright.auth.config.ts and must stay in step with
// it -- the client is compiled with this origin baked in.

import { spawn } from 'node:child_process';

// Keep in step with playwright.auth.config.ts.
const AUTH_SMOKE_PORT = 4178;

const env = {
  ...process.env,
  VITE_STATIC_TARGET: 'web',
  VITE_ROUTER_MODE: 'browser',
  VITE_RUNTIME_MONITORING_ENABLED: 'false',
  VITE_SUPABASE_URL: `http://127.0.0.1:${AUTH_SMOKE_PORT}`,
  VITE_SUPABASE_ANON_KEY: 'auth-smoke-anon-key',
  // Left off on purpose. With relational sync enabled the store loads a
  // workspace profile over the network on every session change, which these
  // tests neither stub nor care about.
  VITE_RELATIONAL_SYNC_ENABLED: '',
  // No local-mode escape hatch: the point is the Supabase-backed path.
  VITE_ALLOW_LOCAL_MODE: '',
  // Providers are covered by tests/authProviders.test.ts and the store suite;
  // pinning it empty keeps the sign-in screen deterministic here.
  VITE_AUTH_OAUTH_PROVIDERS: '',
};

// XBAR_SKIP_MARKETING is deliberately NOT set: the post-build is what splits
// the SPA shell out to dist/app.html, and scripts/serve-dist.mjs serves /app/*
// from that file. Skipping it leaves no app.html and every route 404s.

console.log('[auth-smoke] building web bundle (supabase configured)');

const child = spawn('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
