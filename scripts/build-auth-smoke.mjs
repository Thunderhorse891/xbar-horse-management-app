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
  /*
   * Off explicitly, and by the name the app actually reads.
   *
   * With relational sync on, the store loads a workspace profile over the
   * network on every session change -- requests these tests neither stub nor
   * care about. An earlier revision here set VITE_RELATIONAL_SYNC_ENABLED,
   * which nothing reads (src/lib/platformConfig.ts reads
   * VITE_SUPABASE_RELATIONAL_SYNC, falling back to the former
   * VITE_SUPABASE_RELATIONAL_MIRROR), and an empty string would not have
   * disabled it anyway: readFlag treats empty as "unset" and this flag
   * DEFAULTS TO TRUE. So that build had relational sync enabled -- the opposite
   * of what its comment claimed.
   */
  VITE_SUPABASE_RELATIONAL_SYNC: 'false',
  // No local-mode escape hatch: the point is the Supabase-backed path. Spelled
  // 'false' rather than '' for the same reason -- empty means "use the
  // default", not "off".
  VITE_ALLOW_LOCAL_MODE: 'false',
  // Providers are covered by tests/authProviders.test.ts and the store suite;
  // pinning it empty keeps the sign-in screen deterministic here.
  VITE_AUTH_OAUTH_PROVIDERS: '',
  /*
   * Pinned, not inherited. `env` starts from process.env, so a VITE_NATIVE_APP
   * or XBAR_SKIP_MARKETING left over in the shell -- from a mobile build, say --
   * would quietly turn this into a native bundle, or skip the post-build that
   * produces dist/app.html and leave every /app route 404ing. Neither failure
   * announces itself as a wrong build target.
   */
  VITE_NATIVE_APP: 'false',
  XBAR_SKIP_MARKETING: '',
};

// The post-build (not skipped, see above) is what splits the SPA shell out to
// dist/app.html, which scripts/serve-dist.mjs serves /app/* from.

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
