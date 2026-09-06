/**
 * Whether a session is the one a password-recovery link was validated for.
 *
 * Holding a session and holding a validated recovery are different facts, and
 * only their intersection may change a password. Keeping that comparison in
 * one pure function is what stops the two being conflated again -- an earlier
 * revision gated on a session alone, so an expired link let whoever was signed
 * in change their password on a premise nobody had established.
 *
 * The session is typed structurally rather than as Supabase's Session so this
 * stays free of the client, and therefore testable on its own.
 */
export type RecoveryGateState = {
  session: { user: { id: string } } | null;
  /** The user id Supabase validated a recovery for, or '' for none. */
  passwordRecoveryFor: string;
};

/**
 * The grant a tab may still hold at startup, after accounting for one already
 * spent elsewhere.
 *
 * The grant is deliberately durable -- it survives a reload so a refresh does
 * not report a valid link as expired -- but the only thing that used to clear
 * it was USER_UPDATED, which is a transient broadcast. A tab that was reloading
 * or navigating while another tab completed the reset had no subscriber to
 * receive it, came back, read its still-present grant and a session for the
 * same user, and could set the password again with no new link. A durable
 * grant needs a durable revocation.
 *
 * A later, genuine recovery for the same account clears the spent mark when
 * Supabase validates it, so this only ever retires a grant that has actually
 * been used.
 */
export function reconcileStoredRecovery(input: { storedGrant: string; spentFor: string }): string {
  if (!input.storedGrant) return '';
  return input.storedGrant === input.spentFor ? '' : input.storedGrant;
}

export function hasValidatedPasswordRecovery(state: RecoveryGateState): boolean {
  const grantedTo = state.passwordRecoveryFor;
  if (!grantedTo) return false;
  // A grant that outlived its session must not transfer to the next one.
  return state.session?.user.id === grantedTo;
}

/**
 * The single state the reset screen is in.
 *
 * These were four independent boolean expressions in the JSX, and independent
 * booleans do not add up to exclusive states. A successful update clears the
 * recovery grant -- that is the point of it -- which flipped the "no valid
 * recovery" condition true at the same moment the success condition became
 * true, so the screen simultaneously announced "Password updated" and "This
 * page needs a current password-reset link ... request another". The customer
 * was told their reset both worked and had not.
 *
 * The same shape had a second failure in it: the grant can also clear WHILE a
 * request is in flight (auth-js broadcasts USER_UPDATED to every tab), which
 * would raise the expired-link alert mid-submission.
 *
 * So the screen now asks one question and renders one answer. Order is the
 * meaning: a finished reset outranks everything, an in-flight one is never
 * "refused", and only after those does a missing grant mean refusal.
 */
export type ResetScreenState =
  | 'unavailable' // No cloud auth in this build; there is no password to set.
  | 'done' // The password was changed.
  | 'saving' // A request is in flight; the grant may clear underneath it.
  | 'settling' // The link's session may still be arriving; do not refuse yet.
  | 'form' // A validated recovery is held: show the form.
  | 'refused'; // No validated recovery.

export type ResetScreenInput = {
  supabaseReady: boolean;
  done: boolean;
  submitting: boolean;
  settling: boolean;
  recoveryValid: boolean;
};

export function resetScreenState(input: ResetScreenInput): ResetScreenState {
  if (!input.supabaseReady) return 'unavailable';
  // Ahead of everything else: once the password is changed the grant is gone
  // by design, and reading that absence as a dead link is what went wrong.
  if (input.done) return 'done';
  // A grant cleared mid-request must not become an expired-link error.
  if (input.submitting) return 'saving';
  if (input.settling) return 'settling';
  return input.recoveryValid ? 'form' : 'refused';
}
