import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { loadWorkspaceAccessProfile } from '@/lib/cloudWorkspace';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { UserRole } from '@/types/xbar';
import { authCallbackOrigin, isNativeApp } from '../lib/nativePlatform.js';
import { describeAuthError } from '@/lib/authErrors';
import { bootstrapEventDisposition } from '@/lib/authBootstrap';
import { hasValidatedPasswordRecovery } from '@/lib/passwordRecovery';

export { hasValidatedPasswordRecovery };
import { authRedirectUrl, passwordResetPath, publicAppRouteUrl } from '@/lib/routeCanon';

type CloudActionResult = {
  ok: boolean;
  message: string;
};

/*
 * What a signup actually did, which is not knowable from `error` alone.
 *
 * Supabase deliberately does not fail a signup for an already-registered
 * address: it returns "an obfuscated user response with no verification email
 * sent" so an attacker cannot enumerate accounts. The app read only `error`,
 * so that silence arrived here as success and the screen said "Account created.
 * Check your inbox" about an email that was never sent. Every locked-out
 * customer who then waited for it was waiting on our claim, not on Supabase.
 */
type SignUpOutcome =
  | 'signed-in' // Autoconfirm is on; there is a session and nothing to confirm.
  | 'confirmation-required' // A new account exists and Supabase sent the email.
  | 'existing-account'; // Nothing was created and nothing was sent.

type CloudSignUpResult = CloudActionResult & {
  outcome?: SignUpOutcome;
};

type CloudStatus = 'unavailable' | 'loading' | 'signed-out' | 'signed-in';
type CloudSyncState = 'idle' | 'syncing' | 'error';

type CloudStore = {
  initialized: boolean;
  status: CloudStatus;
  session: Session | null;
  workspaceId: string;
  workspaceRole: UserRole;
  lastSyncAt: string;
  syncState: CloudSyncState;
  syncMessage: string;
  autosaveReady: boolean;
  /*
   * Whether reconciliation actually SETTLED on a copy, as opposed to merely
   * finishing.
   *
   * `autosaveReady` turns true on every path out of CloudBootstrap, including
   * `conflict-lock` and a failed remote load — it means "no longer hydrating",
   * not "the records on screen are this workspace's". Anything that acts on the
   * store's contents as if they belong to the signed-in workspace has to wait
   * for this one instead, and the vault sweep is the case where reading the
   * wrong one deletes a rancher's only copy of a document.
   */
  autosaveUnlocked: boolean;
  initialize: () => Promise<(() => void) | void>;
  setLastSyncAt: (value: string) => void;
  setSyncState: (state: CloudSyncState, message?: string) => void;
  setWorkspaceAccessProfile: (workspaceId: string, workspaceRole?: UserRole) => void;
  // Both arguments are required so a new call site cannot quietly inherit the
  // permissive half of this pair.
  setAutosaveReady: (ready: boolean, unlocked: boolean) => void;
  /*
   * The rancher resolved a `conflict-lock` by hand, choosing a copy with Push
   * cloud or Pull cloud in Settings.
   *
   * Reconciliation is the only other thing that unlocks autosave, and it runs
   * once per hydration: its effect is keyed on the workspace and the session,
   * neither of which changes when someone presses a button in Settings. So
   * without this, resolving the conflict left autosave locked until a reload —
   * while the toast said the sync had completed.
   *
   * A named transition rather than a second argument to `setAutosaveReady`,
   * for the reason given above it: a call site that can pass `ready` is a call
   * site that can promote a half-hydrated workspace. This one cannot. It
   * refuses while hydration is still running, because `finish` is authoritative
   * about which copy won and would overwrite this a moment later anyway.
   */
  unlockAutosaveAfterManualSync: () => void;
  signInWithPassword: (email: string, password: string) => Promise<CloudActionResult>;
  sendMagicLink: (email: string) => Promise<CloudActionResult>;
  /**
   * Email a one-time CODE, and verify it in place.
   *
   * Distinct from sendMagicLink, and the distinction is the whole point on
   * native. A magic link signs the customer in wherever the link opens, which
   * is a browser -- so it cannot deliver a session into the app. A code is
   * typed into the app and exchanged there, which is why it is the only
   * emailed route that actually gets an account INTO a store build.
   */
  sendEmailCode: (email: string) => Promise<CloudActionResult>;
  verifyEmailCode: (email: string, code: string) => Promise<CloudActionResult>;
  signUpWithPassword: (email: string, password: string) => Promise<CloudSignUpResult>;
  resendSignUpConfirmation: (email: string) => Promise<CloudActionResult>;
  updatePassword: (password: string) => Promise<CloudActionResult>;
  /*
   * The user id Supabase validated a recovery link FOR, or '' for none.
   *
   * A bare boolean was wrong: it said a recovery was in progress without
   * saying whose, so it outlived the session it was granted for. If that
   * session ended -- an expired token, a sign-out in another tab -- the flag
   * stayed set, and the next ordinary sign-in in this tab inherited it and
   * could change THAT account's password with no recovery ever validated.
   *
   * Carrying the id makes the mismatch unrepresentable: authorization is only
   * ever compared against the session actually holding it.
   */
  passwordRecoveryFor: string;
  sendPasswordReset: (email: string) => Promise<CloudActionResult>;
  signInWithFacebook: () => Promise<CloudActionResult>;
  signInWithGoogle: () => Promise<CloudActionResult>;
  signInWithApple: () => Promise<CloudActionResult>;
  signOut: () => Promise<CloudActionResult>;
  deleteAccount: (confirmation: string) => Promise<CloudActionResult>;
};

/*
 * Where an emailed auth link should send the customer back to.
 *
 * Every magic link, signup confirmation and password reset is built from this,
 * and on the web the current page is exactly right.
 *
 * Inside a store build it is not. The page origin there is
 * `capacitor://localhost` — a scheme no email client can open and that Supabase
 * will not accept as a redirect — so every one of those emails arrived with a
 * dead link. Signup could not be completed at all where email confirmation is
 * required, and the visible "Forgot password?" action sent a link that goes
 * nowhere. Both are broken features in their own right and rejections under
 * Guideline 2.1.
 *
 * `authCallbackOrigin()` returns the configured public site in a store build,
 * which at least lands the customer somewhere real. It signs them in on the web
 * rather than in the app, which is why the one-time code path exists: a code is
 * verified in-app and needs no callback at all. It returns undefined when there
 * is nothing sensible to use, which tells the Supabase client to fall back to
 * the project's configured Site URL rather than to a scheme it will reject.
 */
function currentAuthRedirectUrl() {
  const nativeOrigin = authCallbackOrigin();
  if (isNativeApp()) return nativeOrigin;
  return typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}${window.location.search}`
    : undefined;
}

/*
 * A validated recovery has to survive a page refresh.
 *
 * auth-js clears the callback fragment once it has validated the link and
 * persists the resulting session, so a reload arrives with a perfectly good
 * recovery session and only an INITIAL_SESSION event. Held in memory alone,
 * the authorization vanished there and the customer was told their valid link
 * had expired.
 *
 * sessionStorage rather than localStorage: this is a one-time flow, and it
 * should not outlive the tab. What is stored is the user id, never a token, so
 * it grants nothing on its own -- it is only ever compared against the session
 * Supabase itself established, and a mismatch authorizes nothing.
 */
const RECOVERY_USER_KEY = 'xbar-password-recovery-for';

function readStoredRecoveryUser(): string {
  try {
    return typeof sessionStorage === 'undefined' ? '' : (sessionStorage.getItem(RECOVERY_USER_KEY) ?? '');
  } catch {
    // Private modes and blocked site data throw on access rather than return
    // null; losing the marker costs a re-request, so it must never throw here.
    return '';
  }
}

function storeRecoveryUser(userId: string) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (userId) sessionStorage.setItem(RECOVERY_USER_KEY, userId);
    else sessionStorage.removeItem(RECOVERY_USER_KEY);
  } catch {
    // Non-fatal: the in-memory flag still carries the current tab.
  }
}

export const useCloudStore = create<CloudStore>((set, get) => ({
  initialized: false,
  passwordRecoveryFor: readStoredRecoveryUser(),
  status: isSupabaseConfigured() ? 'loading' : 'unavailable',
  session: null,
  workspaceId: '',
  workspaceRole: isSupabaseConfigured() ? 'Owner' : 'Admin',
  lastSyncAt: '',
  syncState: 'idle',
  syncMessage: '',
  autosaveReady: !isSupabaseConfigured(),
  // Same rule as `autosaveReady`: with no Supabase project there is no
  // reconciliation to wait for, and a local-only workspace must not be made to
  // wait for something that will never happen.
  autosaveUnlocked: !isSupabaseConfigured(),
  initialize: async () => {
    if (get().initialized) {
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      set({ initialized: true, status: 'unavailable', session: null, workspaceId: '', workspaceRole: 'Admin' });
      return;
    }

    const syncSessionState = async (session: Session | null, initialized = false) => {
      if (!session) {
        set({
          ...(initialized ? { initialized: true } : {}),
          status: 'signed-out',
          session: null,
          workspaceId: '',
          workspaceRole: 'Owner',
        });
        return;
      }

      const accessProfile = await loadWorkspaceAccessProfile(session);
      set({
        ...(initialized ? { initialized: true } : {}),
        status: 'signed-in',
        session,
        workspaceId: accessProfile.workspaceId ?? '',
        workspaceRole: accessProfile.workspaceRole,
      });
    };

    /*
     * Subscribed BEFORE anything is awaited.
     *
     * PASSWORD_RECOVERY is a one-shot notification, scheduled by the URL
     * detection that getSession() waits on. Registering afterwards put it
     * behind getSession AND a workspace network round trip, so it could fire
     * with nobody listening -- and then a recovery arrival is indistinguishable
     * from an ordinary sign-in again, which is the whole thing this flag
     * exists to prevent.
     */
    let bootstrapped = false;
    /*
     * An event that arrived before the first sync finished, kept rather than
     * dropped. `null` means none; a queued entry may itself carry a null
     * session, which is the sign-out case that made this necessary.
     */
    let queuedDuringBootstrap: { session: Session | null } | null = null;
    // Read through a function: control-flow analysis only sees the initializer
    // at the call site below and would otherwise narrow this to `null`.
    const takeQueuedEvent = () => {
      const queued = queuedDuringBootstrap;
      queuedDuringBootstrap = null;
      return queued;
    };
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      // The event was previously discarded entirely, which is why a recovery
      // link used to look like a sign-in.
      if (event === 'PASSWORD_RECOVERY' && session) {
        // Supabase has validated the link; record WHO it was validated for.
        set({ passwordRecoveryFor: session.user.id });
        storeRecoveryUser(session.user.id);
      }
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        /*
         * SIGNED_OUT: otherwise the authorization survives the session it
         * belonged to and is inherited by whoever signs in next in this tab.
         *
         * USER_UPDATED: a recovery ends when the password is actually set, and
         * that can happen in a DIFFERENT tab. auth-js broadcasts the recovery
         * to every open tab, but the store and sessionStorage that record it
         * are tab-local, so clearing only where updatePassword ran left the
         * other tabs holding a spent grant -- able to change the password again
         * with no new link. auth-js broadcasts this event after the update, so
         * every tab that took the grant hears that it is over.
         *
         * Clearing on any other user update is deliberate too: a grant should
         * not outlive a change to the account it was issued against.
         */
        set({ passwordRecoveryFor: '' });
        storeRecoveryUser('');
      }
      /*
       * The explicit getSession() below owns the first sync, so an event that
       * merely restates it is skipped -- but one that CONTRADICTS it is kept
       * and replayed, or the in-flight bootstrap silently overwrites it with a
       * session that has already ended. See lib/authBootstrap.ts.
       */
      const disposition = bootstrapEventDisposition({ bootstrapped, event });
      if (disposition === 'ignore') return;
      if (disposition === 'queue') {
        // Last one wins: it is the most recent thing Supabase has said.
        queuedDuringBootstrap = { session };
        return;
      }
      void syncSessionState(session);
    });

    /*
     * There is deliberately NO fallback that reads `type=recovery` off the URL.
     *
     * A previous revision added one, meaning to be robust about the event's
     * timing. It was the opposite: the URL is supplied by whoever opened the
     * page, so any signed-in customer visiting /reset-password?type=recovery
     * would have marked their own live session recovery-authorized without
     * Supabase validating anything -- reopening, one commit later, exactly the
     * hole that gating on this flag was added to close. The same happens with
     * an EXPIRED fragment, where auth-js keeps the existing session after
     * validation fails.
     *
     * Only Supabase can attest that a recovery link was genuine, and it says
     * so by emitting PASSWORD_RECOVERY. That is why the subscriber above is
     * registered before anything is awaited: the answer to a missed
     * notification is to be listening earlier, not to believe the URL instead.
     */
    const { data, error } = await client.auth.getSession();
    if (error) {
      set({ initialized: true, status: 'signed-out', session: null, workspaceId: '', workspaceRole: 'Owner' });
    } else {
      await syncSessionState(data.session, true);
    }
    bootstrapped = true;

    // Anything that happened while the above was in flight is newer than the
    // above, so it lands last.
    const queued = takeQueuedEvent();
    if (queued) {
      await syncSessionState(queued.session);
    }

    return () => subscription.subscription.unsubscribe();
  },
  setLastSyncAt: (value) => set({ lastSyncAt: value }),
  setSyncState: (state, message = '') => set({ syncState: state, syncMessage: message }),
  setWorkspaceAccessProfile: (workspaceId, workspaceRole = 'Admin') => set({ workspaceId, workspaceRole }),
  setAutosaveReady: (ready, unlocked) => set({ autosaveReady: ready, autosaveUnlocked: unlocked }),
  unlockAutosaveAfterManualSync: () => set((state) => (state.autosaveReady ? { autosaveUnlocked: true } : state)),
  sendMagicLink: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }

    const emailRedirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo,
      },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Magic link sent. Check your inbox to finish sign-in.' };
  },
  signInWithPassword: async (email, password) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }
    if (!password) {
      return { ok: false, message: 'Enter your password.' };
    }

    const { error } = await client.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Signed in. Opening your workspace.' };
  },
  /*
   * REQUIRES the Supabase Magic Link email template to contain {{ .Token }}.
   *
   * An earlier version of this comment claimed that omitting `emailRedirectTo`
   * is what makes Supabase send a code rather than a link. That is not true.
   * Supabase decides from the TEMPLATE: {{ .ConfirmationURL }} sends a magic
   * link, {{ .Token }} sends the six-digit code this screen asks for. The
   * default template is the link, so on an unconfigured project this flow emails
   * something the code input cannot accept — and the OAuth-only customer it
   * exists for stays locked out, now with a form that looks like it should work.
   *
   * The omission still matters, just not for that reason: a redirect would send
   * the customer to a browser, and the app needs the session itself.
   *
   * ios-submission/README.md carries this as a submission prerequisite, because
   * it cannot be configured from code and a build that ships without it has a
   * sign-in path that silently does not work.
   *
   * `shouldCreateUser: false` because this is a sign-IN. Left at its default it
   * silently creates an account for a typo'd address, and the customer waits
   * for a code on an inbox that was never theirs.
   */
  sendEmailCode: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }

    const { error } = await client.auth.signInWithOtp({
      email: trimmedEmail,
      options: { shouldCreateUser: false },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Check your email for a sign-in code.' };
  },
  verifyEmailCode: async (email, code) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();
    if (!trimmedEmail || !trimmedCode) {
      return { ok: false, message: 'Enter the email address and the code that was sent to it.' };
    }

    // 'email' covers both the sign-in code and the signup confirmation code.
    const { error } = await client.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedCode,
      type: 'email',
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Signed in.' };
  },
  signUpWithPassword: async (email, password) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }
    if (password.length < 8) {
      return { ok: false, message: 'Use at least 8 characters for the password.' };
    }

    const emailRedirectTo = currentAuthRedirectUrl();
    const { data, error } = await client.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo,
      },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    if (data.session) {
      return { ok: true, outcome: 'signed-in', message: 'Account created. Opening your workspace.' };
    }

    /*
     * The obfuscated response for an address that is already registered: a user
     * object with no identities on it. Supabase documents the obfuscation but
     * not this shape, so treat a match as evidence and never as a guarantee --
     * the message below is worded to hold either way, which is what keeps this
     * honest if Supabase ever changes how it hides the fact.
     */
    const identities = data.user?.identities;
    const existing = Array.isArray(identities) && identities.length === 0;

    /*
     * Both cases get the same sentence, on purpose.
     *
     * Supabase hides the existing-account case to stop an attacker probing
     * addresses one at a time, and repeating the distinction here would hand
     * back exactly what it withholds. So the copy is written to be true under
     * either branch and to name the next step under both -- which is all the
     * customer needed. The outcome above stays machine-readable for callers
     * that must behave differently without saying anything different.
     */
    const message =
      `Check ${trimmedEmail}. If that address is new to XBAR, a confirmation link is on its way and you ` +
      `must open it before you can sign in. If it already has an account, nothing was sent -- sign in instead, ` +
      `or use "Forgot password?".`;

    return { ok: true, outcome: existing ? 'existing-account' : 'confirmation-required', message };
  },
  resendSignUpConfirmation: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }

    const { error } = await client.auth.resend({
      type: 'signup',
      email: trimmedEmail,
      options: { emailRedirectTo: currentAuthRedirectUrl() },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    // Resend is subject to the same anti-enumeration silence as signup, so this
    // says what was asked for rather than what was delivered.
    return { ok: true, message: `Requested another confirmation email for ${trimmedEmail}.` };
  },
  /*
   * The half of "forgot password" that did not exist.
   *
   * `resetPasswordForEmail` sends the link, and because `detectSessionInUrl`
   * is on, opening it signs the customer in -- so it LOOKED like recovery
   * worked. Nothing anywhere in the app called `auth.updateUser`, so the
   * password itself was never changed: the customer got one session out of the
   * email and was locked out again as soon as it expired.
   */
  updatePassword: async (password) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    if (password.length < 8) {
      return { ok: false, message: 'Use at least 8 characters for the password.' };
    }

    /*
     * updateUser can REJECT, not just return an error, and this function
     * promising to resolve is load-bearing: ResetPassword only clears its busy
     * flag after awaiting it, so a rejection left the screen disabled on
     * "Saving..." for good -- no success, no error, no retry. Nothing told the
     * customer whether their password had changed.
     *
     * It is reachable without anything exotic. auth-js guards this call with a
     * cross-tab Web Lock and hands the lock over after five seconds, so a
     * second tab submitting during a slow request steals it and throws
     * "Lock ... was released because another request stole it" here. auth-js
     * returns its own AuthErrors but rethrows anything else, and that is
     * anything else.
     */
    let outcome: Awaited<ReturnType<typeof client.auth.updateUser>>;
    try {
      outcome = await client.auth.updateUser({ password });
    } catch {
      /*
       * The request was abandoned in flight, so whether the server applied it
       * is genuinely unknown here -- and saying either "done" or "failed" would
       * be a guess. The grant is deliberately left in place: this is not a
       * finished recovery, and the customer may simply try again.
       */
      return {
        ok: false,
        message: 'We could not confirm that change. Try the new password; if it does not work, request another link.',
      };
    }

    if (outcome.error) {
      return { ok: false, message: describeAuthError(outcome.error.message) };
    }

    // Only now is the recovery finished; clearing it earlier would release the
    // screen while the password was still the old one.
    set({ passwordRecoveryFor: '' });
    storeRecoveryUser('');
    return { ok: true, message: 'Password updated. You are signed in.' };
  },
  sendPasswordReset: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter the email address for this workspace.' };
    }

    /*
     * Deliberately NOT currentAuthRedirectUrl(): that returns the page the
     * request was made from, so the link dropped the customer back on the
     * login screen, already signed in, with no way to set a password. It has
     * to return them to the screen that can.
     */
    const nativePublicOrigin = authCallbackOrigin();
    const redirectTo = isNativeApp()
      ? // Undefined when VITE_PUBLIC_APP_URL is unset, which tells Supabase to
        // fall back to the project's own Site URL rather than to a dead scheme.
        nativePublicOrigin
        ? publicAppRouteUrl(passwordResetPath, nativePublicOrigin)
        : undefined
      : authRedirectUrl(passwordResetPath);
    const { error } = await client.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    // Supabase answers the same way for an address it has never seen, so the
    // only honest claim is about the request, not about a delivery.
    return {
      ok: true,
      message: `If ${trimmedEmail} has an XBAR account, a reset link is on its way. Check spam before asking again.`,
    };
  },
  signInWithFacebook: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const redirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo,
      },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Facebook sign-in started.' };
  },
  signInWithGoogle: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const redirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Google sign-in started.' };
  },
  signInWithApple: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const redirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Apple sign-in started.' };
  },
  signOut: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const { error } = await client.auth.signOut();
    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    set({
      session: null,
      status: 'signed-out',
      // Otherwise a later ordinary sign-in inherits a recovery that is over.
      passwordRecoveryFor: '',
      workspaceId: '',
      workspaceRole: 'Owner',
      syncState: 'idle',
      syncMessage: '',
      autosaveReady: false,
      autosaveUnlocked: false,
    });
    return { ok: true, message: 'Signed out of cloud sync.' };
  },
  deleteAccount: async (confirmation: string) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }
    const token = get().session?.access_token;
    if (!token) {
      return { ok: false, message: 'You must be signed in to delete your account.' };
    }

    let response: Response;
    try {
      response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmation }),
      });
    } catch {
      return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
    }

    const payload = await response.json().catch(() => ({}) as { ok?: boolean; message?: string });
    if (!response.ok || !payload.ok) {
      return { ok: false, message: payload.message || 'Account deletion failed. Please try again.' };
    }

    // The server has already deleted the auth user; clear the local session so
    // the app returns to the signed-out state. Caller purges the local workspace.
    await client.auth.signOut().catch(() => {});
    set({
      session: null,
      status: 'signed-out',
      // Otherwise a later ordinary sign-in inherits a recovery that is over.
      passwordRecoveryFor: '',
      workspaceId: '',
      workspaceRole: 'Owner',
      syncState: 'idle',
      syncMessage: '',
      autosaveReady: false,
      autosaveUnlocked: false,
    });
    return { ok: true, message: 'Your account and data have been deleted.' };
  },
}));
