import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapEventDisposition, createLatestWriteGate } from '../src/lib/authBootstrap.js';
import { isRecoveryCallbackUrl } from '../src/lib/authCallbackArrival.js';

/*
 * Two decisions that both exist because auth-js broadcasts to every tab, and
 * both were reported as defects on this branch.
 */

test('an auth event after bootstrap is applied', () => {
  for (const event of ['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED', 'INITIAL_SESSION']) {
    assert.equal(bootstrapEventDisposition({ bootstrapped: true, event }), 'apply', event);
  }
});

test('an event that contradicts the in-flight bootstrap is kept, not dropped', () => {
  /*
   * The defect: every pre-bootstrap event was discarded so the first sync would
   * not run twice. If another tab signed out during that window the SIGNED_OUT
   * went in the bin, then the in-flight getSession result wrote the stale
   * signed-in session and its workspace back -- with nothing left to correct
   * it, so the app kept showing a workspace the customer had signed out of.
   */
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'SIGNED_OUT' }), 'queue');
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'SIGNED_IN' }), 'queue');
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'USER_UPDATED' }), 'queue');
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'TOKEN_REFRESHED' }), 'queue');
});

test('INITIAL_SESSION during bootstrap is ignored rather than queued', () => {
  /*
   * Not an arbitrary exception: it reports the same fact getSession() is about
   * to report. Queueing it would reload the workspace a second time on every
   * startup, which is what the original drop-everything guard existed to avoid
   * -- so replacing that guard must not cost it.
   */
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'INITIAL_SESSION' }), 'ignore');
});

test('a recovery callback is recognised in the fragment and the query', () => {
  // Implicit flow: the session comes back in the fragment.
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/#access_token=abc&type=recovery'), true);
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/#type=recovery&access_token=abc'), true);
  // PKCE and older links put it in the query.
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/reset-password?type=recovery'), true);
});

test('an ordinary URL is not a recovery callback', () => {
  /*
   * This decides which tab NAVIGATES. Matching loosely would put every open tab
   * back to yanking itself to the reset screen, which is the defect it exists
   * to fix.
   */
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/horses'), false);
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/#access_token=abc&type=signup'), false);
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/#/reset-password'), false);
  // Not a bare substring match: `type=recovery` has to be its own parameter.
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/?prototype=recovery-plan'), false);
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/?type=recovery-lite'), false);
});

test('a single write commits', () => {
  const gate = createLatestWriteGate();
  const isStillLatest = gate.begin();
  assert.equal(isStillLatest(), true);
});

test('a write that has been overtaken must not commit', () => {
  /*
   * The defect: syncing a signed-in session waits on a workspace round trip
   * before it writes, while a signed-out one writes at once, and the auth
   * listener starts them without awaiting. So a sign-out landed and the
   * sign-in it replaced finished afterwards and put the old session and
   * workspace back -- with no further event coming to correct it.
   */
  const gate = createLatestWriteGate();
  const older = gate.begin();
  const newer = gate.begin();
  assert.equal(older(), false, 'the overtaken write must drop itself');
  assert.equal(newer(), true, 'the newest write owns the state');
});

test('only the newest of several writes survives', () => {
  const gate = createLatestWriteGate();
  const first = gate.begin();
  const second = gate.begin();
  const third = gate.begin();
  assert.deepEqual([first(), second(), third()], [false, false, true]);
});

test('the newest write stays valid however long it takes', () => {
  // It is not a timeout: a slow write still commits, as long as nothing newer
  // has started. Expiring on duration would drop legitimate slow syncs.
  const gate = createLatestWriteGate();
  const only = gate.begin();
  assert.equal(only(), true);
  assert.equal(only(), true);
});

test('gates are independent of one another', () => {
  // One gate per store initialization, so a second one must not retire the
  // first one's in-flight write.
  const gateA = createLatestWriteGate();
  const gateB = createLatestWriteGate();
  const a = gateA.begin();
  gateB.begin();
  assert.equal(a(), true);
});

test('retiring in flight writes stops them committing, and starts nothing', () => {
  /*
   * Queueing an event during bootstrap does not start a sync -- the replay
   * comes later -- but the bootstrap sync in flight is already writing about a
   * session that has been superseded. Without this it commits the obsolete
   * session and workspace first, and reconciliation can begin against the
   * wrong account in the gap before the replay lands.
   */
  const gate = createLatestWriteGate();
  const inFlight = gate.begin();
  gate.retireInFlight();
  assert.equal(inFlight(), false, 'the superseded write must not commit');

  // And no write was started, so the next one to begin is still the latest.
  const replay = gate.begin();
  assert.equal(replay(), true);
});
