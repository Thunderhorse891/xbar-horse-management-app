import { expect, test, type Page } from '@playwright/test';
import {
  blockWebfonts,
  recoveryLink,
  RECOVERY_KEY,
  sessionLink,
  stubGoTrueUser,
  USER_ID,
  userRecord,
} from './support.js';

/*
 * The reset screen, rendered.
 *
 * tests/passwordRecovery.test.ts pins the two decisions this flow turns on --
 * whether a grant belongs to the session holding it, and which single state the
 * screen is in -- but a pure function cannot show that the screen draws them.
 * Both bugs that shipped here were invisible to unit tests: a genuine recovery
 * link opened a screen that refused it, and a completed reset rendered the
 * success message and the expired-link refusal at the same time.
 *
 * So this suite drives the real machinery end to end. Nothing seeds the store:
 * the grant is established the only way the app accepts one, by auth-js parsing
 * an implicit-flow recovery fragment and emitting PASSWORD_RECOVERY, and it is
 * released the only way the app releases one, by a real updateUser round trip.
 * The two GoTrue endpoints that round trip touches are fulfilled locally; the
 * client code under test is untouched.
 *
 * Supabase is CONFIGURED in this bundle (scripts/build-auth-smoke.mjs). Under
 * the local-mode bundle the prod-smoke suite uses, every assertion below would
 * pass against a screen that only ever says "Cloud accounts are not configured
 * in this build" -- proving nothing.
 *
 * Each test was checked against the defect it exists for, by reintroducing that
 * defect and rebuilding: the named test failed and the others stayed green.
 *
 *   removing the `done` precedence from resetScreenState
 *       -> "a completed reset reports success and does not also claim ..."
 *   hasValidatedPasswordRecovery returning Boolean(session)
 *       -> "being signed in is not a recovery link"
 *   discarding the PASSWORD_RECOVERY event again
 *       -> "a genuine recovery link opens the form"
 *   clearing the grant before updateUser's outcome is known
 *       -> "a rejected update stays retryable and keeps the grant"
 *   releasing the grant on SIGNED_OUT only, not USER_UPDATED
 *       -> "spending the grant in one tab ends it in the other"
 *   letting a rejected updateUser go unhandled in the store
 *       -> "a submission cut short by another tab is told so ..."
 *   removing the `saving` precedence from resetScreenState
 *       -> "a completed reset reports success and does not also claim ..."
 *          (NOT the cut-short case -- see the note on it)
 */

blockWebfonts();

const refusal = (page: Page) => page.getByText(/This page needs a current password-reset link/);
const newPassword = (page: Page) => page.getByLabel('New password', { exact: true });
const confirmPassword = (page: Page) => page.getByLabel('Confirm new password');
const submit = (page: Page) => page.getByRole('button', { name: 'Set new password' });

type ScreenSnapshot = { success: boolean; refused: boolean; form: boolean; saving: boolean; unconfirmed: boolean };

/*
 * Records every distinct state the screen passes through, rather than what it
 * happens to be showing when an assertion runs.
 *
 * Polling for a good state is not good enough here, and that is not
 * hypothetical: with the `done` precedence removed from resetScreenState the
 * screen really does render "Password updated" and "request another link"
 * together -- and then leaves that state again a moment later, so a poll for
 * "success and no refusal" finds the later clean sample and passes. The
 * contradiction has to be forbidden at every instant, not merely absent at
 * some instant.
 *
 * A MutationObserver catches the renders; the interval covers the case where
 * two renders land in one task and the observer only sees the settled DOM.
 */
async function watchScreen(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    const snap = () => {
      // Lower-cased because innerText is the RENDERED text: the field labels
      // and the submit button are upper-cased in CSS, so matching them as
      // written in the JSX quietly never matched and left `form` and `saving`
      // permanently false -- flags that look like coverage and assert nothing.
      const text = document.body.innerText.toLowerCase();
      const state = JSON.stringify({
        success: text.includes('password updated. you are signed in.'),
        refused: text.includes('needs a current password-reset link'),
        form: text.includes('confirm new password'),
        saving: text.includes('saving...'),
        unconfirmed: text.includes('could not confirm that change'),
      });
      if (seen[seen.length - 1] !== state) seen.push(state);
    };
    (window as unknown as { __screenStates: string[] }).__screenStates = seen;
    snap();
    new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, characterData: true });
    window.setInterval(snap, 10);
  });
}

async function observedScreens(page: Page): Promise<ScreenSnapshot[]> {
  const raw = await page.evaluate(() => (window as unknown as { __screenStates: string[] }).__screenStates);
  return raw.map((entry) => JSON.parse(entry) as ScreenSnapshot);
}

async function heldGrant(page: Page) {
  return page.evaluate((key) => window.sessionStorage.getItem(key) ?? '', RECOVERY_KEY);
}

async function fillNewPassword(page: Page, value: string) {
  await newPassword(page).fill(value);
  await confirmPassword(page).fill(value);
}

test('without a recovery link the screen refuses instead of offering a password form', async ({ page }) => {
  await stubGoTrueUser(page);

  // No fragment: nobody has established that a recovery link was followed.
  await page.goto('/app/reset-password');

  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible();

  // Nothing was granted, which is what the refusal is reporting.
  expect(await heldGrant(page)).toBe('');
});

test('being signed in is not a recovery link', async ({ page }) => {
  await stubGoTrueUser(page);

  /*
   * The hole this screen was built to close, and the reason the grant is a user
   * id rather than "there is a session". Gating on the session alone meant
   * anyone already signed in who reached this URL -- following a spent recovery
   * link, or simply navigating here -- got a working form that changed the
   * password of whatever account happened to be signed in.
   *
   * This link carries a real, valid session. It is not a recovery.
   */
  await page.goto(sessionLink('signin'));

  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(page)).toHaveCount(0);

  // The session exists -- so the refusal is about the missing recovery, not
  // about being signed out.
  expect(await page.evaluate(() => Object.keys(window.localStorage).some((key) => key.includes('auth-token')))).toBe(
    true,
  );
  expect(await heldGrant(page)).toBe('');
});

test('a genuine recovery link opens the form', async ({ page }) => {
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());

  // This is what makes the refusal test above mean something: the screen is
  // capable of opening, so refusing is a decision rather than the only thing it
  // ever does.
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  await expect(submit(page)).toBeEnabled();
  await expect(refusal(page)).toHaveCount(0);

  // The grant is recorded against the user Supabase validated the link for --
  // not merely "someone is signed in".
  expect(await heldGrant(page)).toBe(USER_ID);
});

test('a completed reset reports success and does not also claim the link expired', async ({ page }) => {
  await stubGoTrueUser(page);
  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  await fillNewPassword(page, 'a-brand-new-password');
  await watchScreen(page);
  await submit(page).click();

  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible();

  /*
   * The regression this suite exists for. Finishing a reset CLEARS the grant --
   * that is the point of it -- and the screen used to read that absence as a
   * dead link, so it announced the reset had worked and told the customer to
   * request another link, in the same breath.
   *
   * From a form the customer just submitted there is no route to the
   * expired-link refusal, so it may not appear at any point along the way.
   */
  const screens = await observedScreens(page);
  expect(screens.filter((state) => state.refused)).toEqual([]);
  expect(screens.some((state) => state.success)).toBe(true);

  // And the grant really is gone, so the assertion above is not passing because
  // the refusal condition was never true.
  expect(await heldGrant(page)).toBe('');
});

test('a rejected update stays retryable and keeps the grant', async ({ page }) => {
  await stubGoTrueUser(page, async (route) => {
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 422,
        error_code: 'same_password',
        msg: 'New password should be different from the old password.',
      }),
    });
  });

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();

  // GoTrue's own words, not a rewrite of them: describeAuthError only replaces
  // transport failures, so a real rejection reaches the customer intact.
  await expect(page.getByText('New password should be different from the old password.').first()).toBeVisible();

  // A failed update is not a finished recovery. The form has to still be here,
  // still usable, and must not have announced success.
  await expect(page.getByText('Password updated. You are signed in.')).toHaveCount(0);
  await expect(refusal(page)).toHaveCount(0);
  await expect(submit(page)).toBeEnabled();
  await fillNewPassword(page, 'another-attempt-entirely');
  await expect(submit(page)).toBeEnabled();

  // The grant survives, or the customer would be told to request a new link
  // because the server declined the password they chose.
  expect(await heldGrant(page)).toBe(USER_ID);
});

test('spending the grant in one tab ends it in the other', async ({ context }) => {
  /*
   * The store and its sessionStorage marker are tab-local, but a recovery is
   * not: auth-js broadcasts it to every open tab. Clearing the grant only where
   * updatePassword ran left the other tab holding a spent one -- able to set
   * the password again with no new link. auth-js broadcasts USER_UPDATED after
   * the change, which is how the second tab learns its grant is over.
   */
  const first = await context.newPage();
  const second = await context.newPage();
  await stubGoTrueUser(first);
  await stubGoTrueUser(second);

  await first.goto(recoveryLink());
  await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
  await second.goto(recoveryLink());
  await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(second)).toBe(USER_ID);

  await fillNewPassword(first, 'a-brand-new-password');
  await submit(first).click();
  await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible();

  // The second tab never submitted anything, so it is not "done" -- it is a tab
  // holding an authorization that has been used up, and it has to say so.
  await expect(refusal(second)).toBeVisible({ timeout: 15_000 });
  await expect(newPassword(second)).toHaveCount(0);
  expect(await heldGrant(second)).toBe('');
});

test('a submission cut short by another tab is told so, not left on Saving', async ({ context }) => {
  /*
   * Two tabs submitting at once, which auth-js resolves by force: it guards
   * updateUser with a cross-tab Web Lock, and the waiting tab STEALS the lock
   * five seconds in. Stealing it makes the first tab's updateUser REJECT rather
   * than return an error -- and ResetPassword only clears its busy flag after
   * that promise settles, so tab A sat disabled on "Saving..." indefinitely,
   * never told whether its password had changed. updatePassword now honours its
   * contract to resolve.
   *
   * What this case does NOT cover, despite being written to: the grant clearing
   * while this tab's own request is in flight. That scenario is unreachable
   * across tabs, and the lock is why -- tab B can only broadcast USER_UPDATED
   * after it takes the lock, and taking the lock is what kills tab A's request,
   * so tab A has already left `saving` by the time the grant goes. Confirmed by
   * mutation: with `saving` precedence removed this test still passes, and the
   * completed-reset case above is what fails. The real window for that
   * precedence is single-tab and sub-millisecond -- auth-js emits USER_UPDATED
   * before updateUser resolves -- which is exactly what that case records.
   */
  const first = await context.newPage();
  const second = await context.newPage();

  let releaseFirst: () => void = () => {};
  const firstUpdateHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  await stubGoTrueUser(first, async (route) => {
    await firstUpdateHeld;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });
  await stubGoTrueUser(second);

  await first.goto(recoveryLink());
  await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
  await second.goto(recoveryLink());
  await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

  await fillNewPassword(first, 'a-brand-new-password');
  await fillNewPassword(second, 'a-different-new-password');

  await watchScreen(first);
  await submit(first).click();
  await expect(first.getByRole('button', { name: 'Saving...' })).toBeVisible();

  // Waits out the Web Lock, then completes and broadcasts USER_UPDATED.
  await submit(second).click();
  await expect(second.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

  // The grant is now spent, and tab A is still mid-submission. This is the
  // window: "no valid recovery" is true, and it must not surface as an
  // expired-link refusal to someone who is still waiting on their own request.
  expect(await heldGrant(first)).toBe('');

  /*
   * And tab A has to reach an outcome. Whether the server applied its
   * abandoned request is unknowable from here, so the honest answer is that it
   * could not be confirmed -- not silence, and not a claim either way.
   */
  await expect(first.getByText(/could not confirm that change/).first()).toBeVisible({ timeout: 30_000 });

  /*
   * Tab A ends on the refusal, and that is correct rather than the bug this
   * file guards against: the other tab really did spend the grant, so there is
   * nothing left for tab A to retry and requesting a new link is the only way
   * on. What must not happen is arriving there EARLY -- while tab A is still
   * waiting on its own request, when nobody has told it anything yet.
   */
  await expect(first.getByRole('button', { name: 'Back to sign in' })).toBeVisible();

  const screens = await observedScreens(first);
  expect(screens.some((state) => state.saving)).toBe(true);
  const firstRefusal = screens.findIndex((state) => state.refused);
  const firstOutcome = screens.findIndex((state) => state.unconfirmed);
  expect(firstOutcome).toBeGreaterThanOrEqual(0);
  expect(firstRefusal === -1 || firstRefusal >= firstOutcome).toBe(true);

  releaseFirst();
});
