/**
 * Turning a Supabase auth error into something a customer can act on.
 *
 * `error.message` is written for whoever is holding the API, and it goes
 * straight onto the sign-in form. Most of the time that is fine and better than
 * anything a paraphrase could manage: "Invalid login credentials" and "Email
 * not confirmed" each say precisely what to do next. The exception is a
 * transport failure, which supabase-js surfaces as the browser's own wording --
 * "Failed to fetch", "Load failed", "NetworkError when attempting to fetch
 * resource" -- none of which tells a rancher on a weak connection that the
 * problem is the connection and not the password they just typed.
 *
 * So this rewrites that one case and passes everything else through untouched.
 * Blanket-replacing auth errors with a friendly sentence would be worse than
 * the raw string: it would hide "Email not confirmed", which is the single
 * message that explains why a brand-new account cannot sign in.
 */

// Deliberately narrow. Each of these is a browser's phrasing for "the request
// never reached a server", not a response from one.
const TRANSPORT_FAILURE = /failed to fetch|load failed|network ?error|networkerror|err_internet_disconnected/i;

export const OFFLINE_MESSAGE = 'Could not reach XBAR. Check your internet connection and try again.';

export function describeAuthError(message: string): string {
  if (!message.trim()) {
    // An empty message renders as a styled but blank error panel, which reads
    // as a glitch rather than as a failure.
    return 'Something went wrong. Try again.';
  }
  return TRANSPORT_FAILURE.test(message) ? OFFLINE_MESSAGE : message;
}
