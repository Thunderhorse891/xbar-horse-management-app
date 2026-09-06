import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OAUTH_PROVIDERS,
  parseOAuthProviders,
  presentableOAuthProviders,
  type OAuthProvider,
} from '../src/lib/authProviders.js';

/*
 * A provider button that Supabase has not been told about is not a degraded
 * experience, it is a broken one: the redirect comes back 400 "Unsupported
 * provider: provider is not enabled" and the customer sees a button that does
 * nothing. Three of them shipped that way, so these tests hold the two rules
 * that keep it from recurring -- nothing is shown unless it was configured,
 * and nothing is shown in a native build at all.
 */

type CapacitorWindow = { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };

function withWindow(value: CapacitorWindow | undefined, run: () => void) {
  const globals = globalThis as { window?: CapacitorWindow };
  const had = 'window' in globals;
  const previous = globals.window;
  if (value === undefined) delete globals.window;
  else globals.window = value;
  try {
    run();
  } finally {
    if (had) globals.window = previous;
    else delete globals.window;
  }
}

test('an unset variable configures no providers', () => {
  // The default has to be empty rather than "all of them": this is the value
  // every deployment has until someone deliberately enables a provider.
  assert.deepEqual(parseOAuthProviders(undefined), []);
  assert.deepEqual(parseOAuthProviders(''), []);
  assert.deepEqual(parseOAuthProviders('   '), []);
  assert.deepEqual(parseOAuthProviders(',,'), []);
});

test('configured providers are parsed, trimmed and case-folded', () => {
  assert.deepEqual(parseOAuthProviders('google'), ['google']);
  assert.deepEqual(parseOAuthProviders(' Google , APPLE '), ['google', 'apple']);
  assert.deepEqual(parseOAuthProviders('facebook,google,apple'), ['google', 'facebook', 'apple']);
});

test('the order is the declared one, not the order someone typed', () => {
  // Otherwise editing the variable silently reshuffles the button row.
  assert.deepEqual(parseOAuthProviders('apple,google'), ['google', 'apple']);
  assert.deepEqual(parseOAuthProviders('google,apple'), ['google', 'apple']);
});

test('a repeated provider yields one button', () => {
  assert.deepEqual(parseOAuthProviders('google,google,GOOGLE'), ['google']);
});

test('an unknown provider is dropped rather than rendered', () => {
  // signInWithOAuth would reject it anyway; a typo must not become a button.
  assert.deepEqual(parseOAuthProviders('githbu'), []);
  assert.deepEqual(parseOAuthProviders('google,githbu,twitter'), ['google']);
});

test('every declared provider is parseable, so the list cannot drift', () => {
  assert.deepEqual(parseOAuthProviders(OAUTH_PROVIDERS.join(',')), [...OAUTH_PROVIDERS]);
});

test('a web build shows exactly the configured providers', () => {
  const configured: OAuthProvider[] = ['google', 'apple'];
  withWindow({}, () => {
    assert.deepEqual(presentableOAuthProviders(configured), ['google', 'apple']);
  });
  withWindow(undefined, () => {
    assert.deepEqual(presentableOAuthProviders(configured), ['google', 'apple']);
  });
});

test('a native store build shows none of them however many are configured', () => {
  // A web OAuth redirect cannot complete inside the app WebView, so on native
  // the configuration is irrelevant -- the button could never work.
  withWindow({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }, () => {
    assert.deepEqual(presentableOAuthProviders(['google', 'facebook', 'apple']), []);
  });
});

test('a web build with nothing configured shows none', () => {
  withWindow({}, () => {
    assert.deepEqual(presentableOAuthProviders([]), []);
  });
});
