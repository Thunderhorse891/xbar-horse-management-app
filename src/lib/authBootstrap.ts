/**
 * What to do with an auth event that arrives before the first sync has run.
 *
 * `initialize` subscribes to onAuthStateChange BEFORE awaiting anything, because
 * PASSWORD_RECOVERY is a one-shot notification and a late subscriber misses it.
 * That leaves a window: getSession() and then a workspace network round trip run
 * while events can already be arriving, and every one of them used to be
 * dropped so the first sync would not be done twice.
 *
 * Dropping them is wrong for anything that CHANGES the answer. If another tab
 * signs out during that window, the SIGNED_OUT arrives, is discarded, and then
 * the in-flight getSession result lands and writes the stale signed-in session
 * and its workspace back into the store -- with no later event to correct it,
 * so the app keeps showing a workspace the customer has signed out of until
 * they reload.
 *
 * INITIAL_SESSION is the exception, and not an arbitrary one: it reports the
 * same fact getSession() is about to report, so replaying it would reload the
 * workspace a second time on every single startup, which is exactly what the
 * original guard existed to avoid.
 */
export type BootstrapEventInput = {
  bootstrapped: boolean;
  event: string;
};

export type BootstrapEventDisposition =
  | 'apply' // Bootstrap is done; sync it now.
  | 'queue' // Bootstrap is still running; replay this once it finishes.
  | 'ignore'; // Says nothing the first sync is not already about to say.

export function bootstrapEventDisposition(input: BootstrapEventInput): BootstrapEventDisposition {
  if (input.bootstrapped) return 'apply';
  return input.event === 'INITIAL_SESSION' ? 'ignore' : 'queue';
}

/**
 * Lets only the most recently started write commit.
 *
 * Syncing a session is not atomic: a signed-in one waits on a workspace
 * network round trip before it writes, while a signed-out one writes at once.
 * The auth listener starts these without awaiting them, so two can be in
 * flight together and the LAST TO FINISH wins rather than the last to happen.
 * A sign-out therefore lands, and the sign-in it replaced finishes afterwards
 * and puts the old session and workspace back -- with no further event coming,
 * so the app shows a workspace the customer has left until they reload.
 *
 * Ordering by arrival instead of by latency is the whole job. Each write takes
 * a ticket on the way in and checks it on the way out; a write that has been
 * overtaken drops itself instead of committing stale state.
 */
export function createLatestWriteGate() {
  let issued = 0;
  return function begin() {
    const ticket = ++issued;
    return function isStillLatest() {
      return ticket === issued;
    };
  };
}
