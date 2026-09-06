/**
 * Which third-party sign-in buttons this deployment is allowed to show.
 *
 * A provider button is a promise: press it and you get in. Supabase only keeps
 * that promise for providers enabled in the project's auth settings — for any
 * other provider it answers the redirect with HTTP 400 `Unsupported provider:
 * provider is not enabled`. The login screen used to hardcode Google, Facebook
 * and Apple and show all three whenever Supabase was configured at all, so on a
 * project with no provider enabled every one of those buttons was a dead end,
 * and the failure surfaced only as a toast the customer could easily miss.
 *
 * The list is deploy-time configuration rather than a runtime probe because
 * Supabase exposes provider state on `/auth/v1/settings`, and asking for it
 * would put a network round-trip in front of the first paint of the login form
 * to decide whether to draw a button. Configuration is also the honest shape of
 * the fact: enabling a provider already means editing Supabase settings and
 * registering an OAuth client, so recording it in one more place is a step in a
 * process someone is already performing deliberately.
 *
 * Empty is the default, and it means no buttons. Fail-closed matters more here
 * than the reverse: an unlisted-but-working provider costs a customer nothing
 * (email and password are still right there), while a listed-but-disabled one
 * is a door that opens onto a wall.
 */

import { canPresentThirdPartySignIn } from './nativePlatform.js';

export const OAUTH_PROVIDERS = ['google', 'facebook', 'apple'] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

// Same guarded access nativePlatform.ts uses: this module is compiled and
// imported by the node test suites, where import.meta.env does not exist.
const env = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>;

/**
 * Parse the configured provider list.
 *
 * Unknown names are dropped rather than passed through: `signInWithOAuth` would
 * reject them anyway, and a typo silently rendering a "Githbu" button is worse
 * than a typo rendering nothing.
 */
export function parseOAuthProviders(raw: string | undefined): OAuthProvider[] {
  if (!raw) return [];
  const requested = new Set(raw.split(',').map((entry) => entry.trim().toLowerCase()));
  // A single enforcement point, deliberately: a name reaches the UI only by
  // matching a declared provider, and it arrives in declaration order so the
  // button row does not reshuffle because someone reordered a variable.
  return OAUTH_PROVIDERS.filter((provider) => requested.has(provider));
}

export function configuredOAuthProviders(): OAuthProvider[] {
  return parseOAuthProviders(env.VITE_AUTH_OAUTH_PROVIDERS);
}

/**
 * The providers the current build may actually draw, which is the intersection
 * of two independent reasons a button would not work.
 *
 * A native store build cannot complete a web OAuth redirect at all, so it shows
 * none regardless of configuration; a web build shows the configured ones.
 * Login renders from this rather than composing the two conditions itself, so
 * there is a single answer to "should this button exist" to point tests at.
 *
 * The configured list is a defaulted parameter because `import.meta.env` does
 * not exist under the node test runner: without it the web branch would read
 * as empty for the same reason the native branch does, and a test could not
 * tell a working gate from a broken one.
 */
export function presentableOAuthProviders(configured: OAuthProvider[] = configuredOAuthProviders()): OAuthProvider[] {
  if (!canPresentThirdPartySignIn()) return [];
  return configured;
}
