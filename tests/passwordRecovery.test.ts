import assert from 'node:assert/strict';
import test from 'node:test';
import { hasValidatedPasswordRecovery, resetScreenState } from '../src/lib/passwordRecovery.js';

/*
 * Holding a session is not the same fact as holding a validated recovery, and
 * conflating them is how this screen twice came to change a password on a
 * premise nobody had established: first by gating on a session alone, then by
 * letting a grant outlive the session it was issued for.
 */

const session = (id: string) => ({ user: { id } });

test('a session with no recovery grant cannot change a password', () => {
  // The original defect: being signed in was treated as proof of a valid link.
  assert.equal(hasValidatedPasswordRecovery({ session: session('user-a'), passwordRecoveryFor: '' }), false);
});

test('a grant matching the current session authorizes it', () => {
  assert.equal(hasValidatedPasswordRecovery({ session: session('user-a'), passwordRecoveryFor: 'user-a' }), true);
});

test('a grant does not transfer to a different account', () => {
  /*
   * The inherited-authorization case: a recovery session ends (token expiry, a
   * sign-out in another tab) and someone else signs in to the same tab. A bare
   * boolean would still read "recovery in progress" and let that new account's
   * password be changed with nothing validated.
   */
  assert.equal(hasValidatedPasswordRecovery({ session: session('user-b'), passwordRecoveryFor: 'user-a' }), false);
});

test('a grant with no session authorizes nothing', () => {
  assert.equal(hasValidatedPasswordRecovery({ session: null, passwordRecoveryFor: 'user-a' }), false);
});

test('neither a session nor a grant authorizes nothing', () => {
  assert.equal(hasValidatedPasswordRecovery({ session: null, passwordRecoveryFor: '' }), false);
});

test('an empty grant is never satisfied, even by an empty id', () => {
  // Guards against '' == '' quietly authorizing a malformed session.
  assert.equal(hasValidatedPasswordRecovery({ session: session(''), passwordRecoveryFor: '' }), false);
});

/*
 * The reset screen's states have to be mutually exclusive, because the events
 * driving them overlap. Completing a reset CLEARS the recovery grant -- that is
 * the point of it -- so "the password was changed" and "there is no valid
 * recovery" become true at the same instant. As four independent booleans in
 * the JSX, both branches rendered: the screen announced "Password updated" and
 * "request another reset link" together, telling the customer their reset had
 * both worked and not.
 */

const base = { supabaseReady: true, done: false, submitting: false, settling: false, recoveryValid: true };

test('a completed reset reads as done, never as an expired link', () => {
  // The reported regression, in the state it actually occurs in: the update
  // succeeded, so `done` is set AND the grant has already been cleared.
  assert.equal(resetScreenState({ ...base, done: true, recoveryValid: false }), 'done');
});

test('a grant clearing mid-request does not become an expired-link error', () => {
  // auth-js broadcasts USER_UPDATED to every tab, so the grant can vanish while
  // the request is still resolving.
  assert.equal(resetScreenState({ ...base, submitting: true, recoveryValid: false }), 'saving');
});

test('a validated recovery shows the form', () => {
  assert.equal(resetScreenState(base), 'form');
});

test('no validated recovery is refused', () => {
  assert.equal(resetScreenState({ ...base, recoveryValid: false }), 'refused');
});

test('an arriving session is not refused before it settles', () => {
  // The link carries the session, so "not yet" must not read as "never".
  assert.equal(resetScreenState({ ...base, settling: true, recoveryValid: false }), 'settling');
});

test('an unconfigured build says so rather than refusing a link', () => {
  assert.equal(resetScreenState({ ...base, supabaseReady: false, recoveryValid: false }), 'unavailable');
  assert.equal(resetScreenState({ ...base, supabaseReady: false, done: true }), 'unavailable');
});

test('every combination resolves to exactly one state', () => {
  /*
   * The property that matters, checked exhaustively rather than by example:
   * the screen is never in two states at once, which is the whole failure.
   */
  const bools = [false, true];
  const seen = new Set<string>();
  for (const supabaseReady of bools)
    for (const done of bools)
      for (const submitting of bools)
        for (const settling of bools)
          for (const recoveryValid of bools) {
            const state = resetScreenState({ supabaseReady, done, submitting, settling, recoveryValid });
            assert.ok(typeof state === 'string' && state.length > 0);
            seen.add(state);
            // 'done' and 'refused' are the pair that rendered together.
            if (done && supabaseReady) assert.equal(state, 'done', 'a finished reset must outrank every other state');
          }
  assert.deepEqual(
    [...seen].sort(),
    ['done', 'form', 'refused', 'saving', 'settling', 'unavailable'],
    'every declared state must be reachable, or one of them is dead code',
  );
});
