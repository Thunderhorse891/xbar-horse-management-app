import { type FormEvent, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { hasValidatedPasswordRecovery, useCloudStore } from '@/store/useCloudStore';
import { resetScreenState } from '@/lib/passwordRecovery';
import { useUiStore } from '@/store/useUiStore';
import './cleanEntryExperience.css';

/*
 * Where a password reset finishes.
 *
 * "Forgot password?" has always sent an email, and because Supabase is
 * configured with `detectSessionInUrl`, opening the link signed the customer
 * in. That made the flow look complete from the outside while the password was
 * never changed -- nothing in the app called `auth.updateUser`. The session
 * from that link is temporary, so the customer was locked out again the moment
 * it lapsed, having been told their reset succeeded.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const passwordId = useId();
  const confirmId = useId();
  const pushToast = useUiStore((state) => state.pushToast);
  const updatePassword = useCloudStore((state) => state.updatePassword);
  const status = useCloudStore((state) => state.status);
  const recoveryPending = useCloudStore(hasValidatedPasswordRecovery);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [done, setDone] = useState(false);

  const supabaseReady = isSupabaseConfigured();
  // The link itself carries the session, so it is still arriving on first
  // paint. Treating "no session yet" as "link expired" would reject people
  // holding a perfectly good link.
  const settling = status === 'loading';
  /*
   * A session is NOT proof that a valid reset link was followed.
   *
   * Gating on `session` alone meant that anyone already signed in who opened
   * this screen -- following an expired or reused recovery link, or simply
   * navigating here -- got a working form that changed the password of
   * whatever account happened to be signed in. A dead link would silently
   * succeed against the wrong premise instead of being refused.
   *
   * So the recovery itself has to be established, and only Supabase can attest
   * to that -- it does so by emitting PASSWORD_RECOVERY. Reading the URL for a
   * `type=recovery` marker instead would be forgeable by whoever opened the
   * page, which is the same hole in a new coat.
   *
   * Note this app has no signed-in "change my password" screen at all, so this
   * refusal is a genuine dead end for someone who merely wants one. That is a
   * real gap, but the answer is a Settings capability that verifies the
   * current password -- not this screen quietly accepting a live session as
   * proof of an emailed link.
   */
  /*
   * One question, one answer. Independent booleans here previously let the
   * success and refusal branches render together: completing a reset clears
   * the grant, which is exactly what "no valid recovery" was testing for.
   */
  const screen = resetScreenState({
    supabaseReady,
    done,
    submitting: busy,
    settling,
    recoveryValid: recoveryPending,
  });

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => navigate('/', { replace: true }), 2200);
    return () => clearTimeout(timer);
  }, [done, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      // Checked here rather than at Supabase, which only ever sees one of them.
      setMessage({ tone: 'error', text: 'Those two passwords do not match.' });
      return;
    }
    setBusy(true);
    const result = await updatePassword(password);
    setMessage({ tone: result.ok ? 'success' : 'error', text: result.message });
    pushToast({
      title: result.ok ? 'Password updated' : 'We could not update that',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setPassword('');
      setConfirm('');
      setDone(true);
    }
    setBusy(false);
  };

  return (
    <main className="clean-entry-shell clean-entry-shell--brand-auth">
      <section className="clean-login-layout" aria-label="Choose a new XBAR password">
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
            <p>Account recovery</p>
            <h1>New Password</h1>
            <span>Choose a new password for your workspace. Until you do, the old one still applies.</span>
          </div>

          {screen === 'unavailable' && (
            <p className="clean-auth-message clean-auth-message--error" role="alert">
              Cloud accounts are not configured in this build, so there is no password to change.
            </p>
          )}

          {screen === 'refused' && (
            <p className="clean-auth-message clean-auth-message--error" role="alert">
              This page needs a current password-reset link. Recovery links expire, and each new one cancels the last,
              so request another from the sign-in screen.
            </p>
          )}

          {(screen === 'form' || screen === 'saving') && (
            <form className="clean-form" onSubmit={submit} aria-busy={busy}>
              <div className="clean-field">
                <label htmlFor={passwordId}>New password</label>
                <div className="clean-password-field">
                  <input
                    id={passwordId}
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (message?.tone === 'error') setMessage(null);
                    }}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShow((value) => !value)}
                    aria-label={show ? 'Hide entered value' : 'Show entered value'}
                  >
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div className="clean-field">
                <label htmlFor={confirmId}>Confirm new password</label>
                <input
                  id={confirmId}
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    if (message?.tone === 'error') setMessage(null);
                  }}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <button className="clean-primary-button" type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Set new password'}
              </button>
            </form>
          )}

          {message && (
            <p
              className={`clean-auth-message clean-auth-message--${message.tone}`}
              role={message.tone === 'error' ? 'alert' : 'status'}
            >
              {message.text}
            </p>
          )}

          {screen === 'done' && <p className="clean-auth-hint">Taking you to your workspace...</p>}

          {screen === 'refused' && (
            <div className="clean-auth-footer">
              <button type="button" onClick={() => navigate('/login', { replace: true })}>
                Back to sign in
              </button>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
