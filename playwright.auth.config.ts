import { defineConfig } from '@playwright/test';

// Runs the password-recovery flow against the BUILT web bundle, with Supabase
// configured. tests/passwordRecovery.test.ts already pins the two pure
// decisions (who a grant belongs to, and which single state the screen is in);
// what it cannot show is that the screen actually renders them -- that a real
// PASSWORD_RECOVERY from a real recovery link opens the form, and that a real
// completed update does not also draw the expired-link refusal. Both of those
// bugs shipped, and both were invisible to unit tests.
//
// The bundle is produced by scripts/build-auth-smoke.mjs before this config
// runs; the webServer only serves the already-built dist. serve-dist mirrors
// production routing, so /app/reset-password resolves from dist/app.html the
// way vercel.json rewrites it.
export default defineConfig({
  testDir: './tests/auth-smoke',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    // Same origin the bundle was compiled with (see build-auth-smoke.mjs):
    // the Supabase client points here too, so auth calls stay same-origin and
    // are interceptable rather than leaving the machine.
    baseURL: 'http://127.0.0.1:4178',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Point at a preinstalled Chromium when the bundled browser is unavailable
    // (e.g. restricted CI/sandbox). Set XBAR_CHROME=/path/to/chrome.
    ...(process.env.XBAR_CHROME ? { launchOptions: { executablePath: process.env.XBAR_CHROME } } : {}),
  },
  webServer: {
    command: 'node ./scripts/serve-dist.mjs --port 4178',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
