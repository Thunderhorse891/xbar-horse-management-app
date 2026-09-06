import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { billingPath, billingPathForTier } from '@/lib/billingRoutes';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './cleanEntryExperience.css';
import { canPresentThirdPartySignIn, canPresentPurchaseFlow } from '@/lib/nativePlatform';
import { presentableOAuthProviders } from '@/lib/authProviders';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'google' | 'facebook' | 'apple' | 'reset' | 'code' | 'verify' | 'resend' | '';
type FormMessage = { tone: 'success' | 'error'; text: string };

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const pushToast = useUiStore((state) => state.pushToast);
  const cloud = useCloudStore();
  const setUpWorkspace = useXbarStore((state) => state.initializeWorkspace);
  const [email, setEmail] = useState(() => localStorage.getItem('xbar-remembered-email') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('xbar-remember-me') === 'true');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<BusyState>('');
  const [formMessage, setFormMessage] = useState<FormMessage | null>(null);
  // Set only once a signup returns without a session, so the screen can stop
  // being a form and start being instructions about an inbox.
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const authMode: AuthMode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  const selectedPlan = params.get('plan') ?? '';
  const workspaceSetupPath = useMemo(() => {
    const setupParams = new URLSearchParams();
    if (selectedPlan) setupParams.set('plan', selectedPlan);
    const query = setupParams.toString();
    return query ? `/setup?${query}` : '/setup';
  }, [selectedPlan]);
  const redirectTarget = useMemo(() => {
    if (authMode === 'signup') return workspaceSetupPath;
    const from = (location.state as { from?: string } | null)?.from;
    if (from) return from;
    // A store build has no purchase path, so sending someone to billing the
    // moment they sign in is an arrival at a paywall they cannot act on.
    if (!canPresentPurchaseFlow()) return '/';
    return selectedPlan ? billingPathForTier(selectedPlan) : billingPath;
  }, [authMode, location.state, selectedPlan, workspaceSetupPath]);
  const supabaseReady = isSupabaseConfigured();
  // A button per provider this deployment has actually enabled in Supabase.
  // Anything else redirects into `Unsupported provider: provider is not
  // enabled`, which is a 400 the customer experiences as "the button does
  // nothing".
  const oauthProviders = useMemo(() => presentableOAuthProviders(), []);

  const setMode = (mode: AuthMode) => {
    // A message about the previous mode is worse than no message: "Confirm
    // your email" left standing over a sign-in form reads as an instruction.
    setFormMessage(null);
    setConfirmationEmail('');
    const next = new URLSearchParams();
    if (mode === 'signup') next.set('mode', 'signup');
    if (selectedPlan) next.set('plan', selectedPlan);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (cloud.session && cloud.status === 'signed-in') navigate(redirectTarget, { replace: true });
  }, [cloud.session, cloud.status, navigate, redirectTarget]);

  /*
   * Every auth outcome has to land in the form, not only in a toast.
   *
   * Toasts are transient and live in a corner: a customer who mistypes a
   * password watches the button go from "Authenticating..." back to "Sign In"
   * with nothing to read, and concludes the button is broken. Reporting
   * through one function is what guarantees it -- there is no path that can
   * raise a toast and forget the panel, because the panel is not optional here.
   */
  const report = (title: string, result: { ok: boolean; message: string }) => {
    const tone = result.ok ? 'success' : 'error';
    pushToast({ title, message: result.message, tone });
    setFormMessage({ tone, text: result.message });
  };
  const rememberEmailPreference = () => {
    if (remember) {
      localStorage.setItem('xbar-remember-me', 'true');
      localStorage.setItem('xbar-remembered-email', email);
    } else {
      localStorage.removeItem('xbar-remember-me');
      localStorage.removeItem('xbar-remembered-email');
    }
  };

  const markLocalWorkspaceIntent = () => {
    localStorage.setItem('xbar-command-center-entry', 'true');
    if (selectedPlan) localStorage.setItem('xbar-local-plan-intent', selectedPlan);
    void trackRuntimeEvent(
      productEvent(productEventNames.localWorkspaceEntered, {
        selectedPlan: selectedPlan || undefined,
        storage: 'browser-local',
      }),
    );
  };

  const openBrowserWorkspace = () => {
    markLocalWorkspaceIntent();
    setUpWorkspace({ businessName: 'XBAR Ranch', ranchName: 'XBAR Ranch' });
    navigate(canPresentPurchaseFlow() ? (selectedPlan ? billingPathForTier(selectedPlan) : billingPath) : '/', {
      replace: true,
    });
  };

  const openWorkspaceSetup = () => {
    markLocalWorkspaceIntent();
    navigate(workspaceSetupPath);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('password');
    rememberEmailPreference();
    if (!supabaseReady) {
      // No cloud auth is configured in this build, so no credentials were
      // checked — never report a sign-in that did not happen.
      pushToast({
        title: 'Local workspace opened',
        message: 'Cloud sign-in is not configured in this build, so XBAR opened your browser-local workspace instead.',
        tone: 'info',
      });
      openBrowserWorkspace();
      setBusy('');
      return;
    }
    if (authMode === 'signin') {
      const result = await cloud.signInWithPassword(email, password);
      report(result.ok ? 'Welcome back' : 'We could not sign you in', result);
      setBusy('');
      return;
    }

    const result = await cloud.signUpWithPassword(email, password);
    // "Account created" is only true when one was, and only a session proves
    // it: the other successful outcomes are a request for a confirmation that
    // has not happened yet, so the screen switches to waiting on the inbox.
    /*
     * Only a session proves an account was created. The other two outcomes are
     * deliberately indistinguishable to the customer -- Supabase hides which
     * one happened to prevent enumeration -- so the heading must not assert
     * that a confirmation is waiting, which is false for an address that
     * already had an account and is exactly the claim that stranded one.
     */
    report(
      result.ok
        ? result.outcome === 'signed-in'
          ? 'Account created'
          : 'Check your email'
        : 'We could not create that account',
      result,
    );
    if (result.ok && result.outcome !== 'signed-in') {
      setConfirmationEmail(email.trim());
    }
    setBusy('');
  };
  const resendConfirmation = async () => {
    setBusy('resend');
    const result = await cloud.resendSignUpConfirmation(confirmationEmail || email);
    report(result.ok ? 'Confirmation email requested' : 'We could not send that again', result);
    setBusy('');
  };
  const oauth = async (provider: 'google' | 'facebook' | 'apple') => {
    setBusy(provider);
    const result =
      provider === 'google'
        ? await cloud.signInWithGoogle()
        : provider === 'facebook'
          ? await cloud.signInWithFacebook()
          : await cloud.signInWithApple();
    report(result.ok ? `Continue with ${provider}` : `${provider} sign-in unavailable`, result);
    setBusy('');
  };
  /*
   * The only route into a store build for an account that has no password.
   *
   * Hiding the OAuth buttons on native (they cannot complete in a WebView)
   * removed the sole credential of every account created through Google, Apple
   * or Facebook. Those accounts have no password, so the password form cannot
   * help them, and "Forgot password?" resets a password that was never set.
   *
   * A CODE rather than a magic link, and the difference is the whole fix. A
   * link signs the customer in wherever it opens, which is a browser -- the
   * app never receives the session, so the account is still locked out of iOS.
   * A code is typed in here and exchanged here, so the session lands in the
   * app. This screen previously offered the link, which read like a solution
   * and was not one.
   */
  const [emailCode, setEmailCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const requestEmailCode = async () => {
    setBusy('code');
    const result = await cloud.sendEmailCode(email);
    if (result.ok) setCodeSent(true);
    report(result.ok ? 'Sign-in code sent' : 'Sign-in code unavailable', result);
    setBusy('');
  };
  const submitEmailCode = async () => {
    setBusy('verify');
    const result = await cloud.verifyEmailCode(email, emailCode);
    report(result.ok ? 'Welcome back' : 'That code did not work', result);
    if (result.ok) setEmailCode('');
    setBusy('');
  };
  const reset = async () => {
    setBusy('reset');
    const result = await cloud.sendPasswordReset(email);
    report(result.ok ? 'Check your inbox' : 'Reset unavailable', result);
    setBusy('');
  };
  const label = authMode === 'signin' ? 'System access' : selectedPlan ? `${selectedPlan} tier` : 'New workspace';
  const title = authMode === 'signin' ? 'Sign In' : 'Create Account';
  const description = selectedPlan
    ? `Create credentials, set up your workspace, then continue to the ${selectedPlan} plan.`
    : authMode === 'signin'
      ? 'Sign in to your workspace.'
      : 'Create a sign-in for your XBAR workspace.';

  return (
    <main className="clean-entry-shell clean-entry-shell--brand-auth">
      <section
        className="clean-login-layout"
        aria-label={authMode === 'signin' ? 'Sign in to XBAR' : 'Create an XBAR account'}
      >
        <aside className="clean-login-visual" aria-label="XBAR brand">
          <img
            className="clean-login-visual__horse"
            src="/brand/xbar-horse-outline-safe.png"
            width="980"
            height="331"
            alt=""
          />
          <img
            className="clean-login-visual__watermark"
            src="/brand/xbar-x-watermark-main.png"
            width="512"
            height="512"
            alt=""
          />
          <div className="clean-login-visual__copy">
            <img
              className="clean-login-visual__wordmark"
              src="/brand/xbar-wordmark.png"
              width="420"
              height="120"
              alt="XBAR"
            />
            <h2>XBAR Ranch Management</h2>
            <p>Keep your horse records, documents, and sale packets organized in one place.</p>
          </div>
          <dl className="clean-login-proof" aria-label="XBAR workspace">
            <div>
              <dt>Local-first</dt>
              <dd>Start offline</dd>
            </div>
            <div>
              <dt>Cloud sync</dt>
              <dd>When configured</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>Ready when you are</dd>
            </div>
          </dl>
        </aside>

        <section className="clean-auth-card clean-auth-card--login">
          <a className="clean-brand clean-brand--login" href="/" aria-label="XBAR home">
            <span className="clean-brand__mark" aria-hidden="true">
              <XbarMark tone="mono" />
            </span>
            <span>
              <strong>XBAR</strong>
              <small>Horse records</small>
            </span>
          </a>

          <div className="clean-auth-card__header">
            <p>{label}</p>
            <h1>{title}</h1>
            <span>{description}</span>
          </div>

          {confirmationEmail && (
            <div className="clean-auth-callout" role="status">
              <h2>Check {confirmationEmail}</h2>
              <p>
                If that address is new to XBAR, a confirmation link is on its way and you must open it before you can
                sign in. If it already has an account, nothing was sent -- sign in instead, or use "Forgot password?".
                Either way, check spam before asking for another.
              </p>
              <div className="clean-auth-callout__actions">
                <button type="button" disabled={busy !== ''} onClick={() => void resendConfirmation()}>
                  {busy === 'resend' ? 'Sending...' : 'Send it again'}
                </button>
                <button type="button" disabled={busy !== ''} onClick={() => setMode('signin')}>
                  Back to sign in
                </button>
              </div>
            </div>
          )}

          <form className="clean-form" onSubmit={submit} aria-busy={busy !== ''}>
            <div className="clean-field">
              <label htmlFor={emailId}>Email or User ID</label>
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (formMessage?.tone === 'error') setFormMessage(null);
                }}
                autoComplete="email"
                required
              />
            </div>
            <div className="clean-field">
              <label htmlFor={passwordId}>Password</label>
              <div className="clean-password-field">
                <input
                  id={passwordId}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (formMessage?.tone === 'error') setFormMessage(null);
                  }}
                  autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide entered value' : 'Show entered value'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div className="clean-auth-options">
              <label>
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />{' '}
                Remember me
              </label>
              {authMode === 'signin' && supabaseReady && (
                <button type="button" disabled={!email || busy !== ''} onClick={reset}>
                  {busy === 'reset' ? 'Sending...' : 'Forgot password?'}
                </button>
              )}
            </div>
            <button
              className="clean-primary-button"
              type="submit"
              disabled={!email || password.length < 8 || busy !== ''}
            >
              {busy === 'password' ? 'Authenticating...' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
            {formMessage && (
              <p
                className={`clean-auth-message clean-auth-message--${formMessage.tone}`}
                role={formMessage.tone === 'error' ? 'alert' : 'status'}
              >
                {formMessage.text}
              </p>
            )}
            {supabaseReady && !canPresentThirdPartySignIn() && authMode === 'signin' && (
              <>
                <div className="clean-divider">
                  <span>or</span>
                </div>
                <button type="button" disabled={busy !== '' || !email.trim()} onClick={() => void requestEmailCode()}>
                  {busy === 'code' ? 'Sending...' : codeSent ? 'Send another code' : 'Email me a sign-in code'}
                </button>
                {codeSent && (
                  <>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code"
                      value={emailCode}
                      onChange={(event) => setEmailCode(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={busy !== '' || !emailCode.trim()}
                      onClick={() => void submitEmailCode()}
                    >
                      {busy === 'verify' ? 'Checking...' : 'Sign in with code'}
                    </button>
                  </>
                )}
                {/*
                  Reachable is not the same as findable. Someone who signed up
                  with Google arrives here, finds their button gone, and has no
                  reason to think an emailed code is the route in — so the
                  control has to say who it is for, or the app reads as broken.
                */}
                <p className="clean-auth-hint">
                  If you first signed up with Google, Apple or Facebook, use this — those buttons cannot complete
                  sign-in inside the app.
                </p>
              </>
            )}
            {supabaseReady && oauthProviders.length > 0 && (
              <>
                <div className="clean-divider">
                  <span>or continue with</span>
                </div>
                <div className="clean-social-grid">
                  {oauthProviders.map((provider) => (
                    <button key={provider} type="button" disabled={busy !== ''} onClick={() => oauth(provider)}>
                      {provider[0].toUpperCase() + provider.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </form>

          <div className="clean-auth-footer">
            {supabaseReady ? (
              <div>
                <span>{authMode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span>
                <button type="button" onClick={() => setMode(authMode === 'signin' ? 'signup' : 'signin')}>
                  {authMode === 'signin' ? 'Create account' : 'Sign in'}
                </button>
              </div>
            ) : (
              <div>
                <span>Starting fresh?</span>
                <button type="button" onClick={openWorkspaceSetup}>
                  Create workspace
                </button>
              </div>
            )}
            {canPresentPurchaseFlow() && <a href="/pricing">View plans</a>}
            <span>© 2026 XBAR</span>
          </div>
        </section>
      </section>
    </main>
  );
}
