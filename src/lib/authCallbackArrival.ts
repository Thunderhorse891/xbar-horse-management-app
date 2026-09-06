/**
 * Whether THIS tab is the one that opened a password-recovery link.
 *
 * auth-js broadcasts PASSWORD_RECOVERY to every open tab, so every tab records
 * the grant -- which is correct, and is what lets a spent grant be released
 * everywhere. It is not a reason for every tab to NAVIGATE. Without this, a
 * recovery link opened in a new tab yanked every other open XBAR tab to the
 * reset screen, unmounting whatever the customer had in progress there.
 *
 * Captured once at module load because auth-js clears the fragment the moment
 * it validates the callback: by the time React renders there is nothing left to
 * read.
 *
 * THIS DECIDES NAVIGATION ONLY AND MUST NEVER GATE AUTHORIZATION. The URL is
 * supplied by whoever opened the page. An earlier revision of this flow derived
 * the recovery grant from `type=recovery` and that was forgeable -- any
 * signed-in customer could authorize a password change on their own live
 * session. Used for routing alone it grants nothing: a forged fragment moves
 * you to a screen that then refuses you, because the screen still requires a
 * grant Supabase itself issued against your session.
 */
const RECOVERY_CALLBACK = /(^|[#?&])type=recovery(&|$)/;

export function isRecoveryCallbackUrl(url: string): boolean {
  return RECOVERY_CALLBACK.test(url);
}

const arrivedWithRecoveryCallback = typeof window === 'undefined' ? false : isRecoveryCallbackUrl(window.location.href);

/** True only in the tab whose own URL carried the recovery callback. */
export function tabOpenedRecoveryCallback(): boolean {
  return arrivedWithRecoveryCallback;
}
