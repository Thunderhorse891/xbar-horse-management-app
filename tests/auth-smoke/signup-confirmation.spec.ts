import { expect, test } from '@playwright/test';
import { blockWebfonts, RECOVERY_EMAIL, stubGoTrueUser, userRecord } from './support.js';

/*
 * The signup screen after Supabase has answered.
 *
 * Signup is the half of this PR that could not be checked by reading a store
 * result: the message was already neutral, and the screen contradicted it
 * anyway -- first by asserting a confirmation email that may never have been
 * sent, and then, once that was fixed, by leaving the signup form standing
 * underneath the instruction to go and read one.
 */

blockWebfonts();

test('after signup the screen waits on the inbox instead of offering signup again', async ({ page }) => {
  /*
   * Supabase will not fail a signup for an address that already exists -- it
   * returns an obfuscated user with no identities and sends nothing -- so this
   * is the response a customer retrying their own address gets.
   */
  await page.route('**/auth/v1/signup*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...userRecord(), identities: [] }),
    });
  });
  await stubGoTrueUser(page);

  await page.goto('/app/login?mode=signup');
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('Email or User ID').fill(RECOVERY_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill('a-brand-new-password');
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page.getByRole('heading', { name: `Check ${RECOVERY_EMAIL}` })).toBeVisible();

  /*
   * The form has to be GONE, not merely pushed below the fold. Telling someone
   * to go and open an email while still offering the button that produced it --
   * address and password still filled -- invites the press that spends the
   * signup email allowance on duplicates.
   */
  await expect(page.getByRole('button', { name: 'Create Account' })).toHaveCount(0);
  await expect(page.getByLabel('Email or User ID')).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);

  // What it offers instead, both of which are correct here.
  await expect(page.getByRole('button', { name: 'Send it again' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible();

  /*
   * And outcomes still reach the SCREEN here, not only a toast.
   *
   * The panel that reports them was inside the form, so replacing the form is
   * exactly where that guarantee could have been dropped -- and the resend
   * button is the confirmation state's own action, so its outcome is the thing
   * that would have gone missing. A rate limit in particular has to be
   * readable: it is the specific answer to "the email has not arrived, press
   * it again", and a toast in the corner is how that came to look like a
   * button that does nothing.
   *
   * Asserted on the RESEND result rather than the callout's own wording, which
   * repeats the store's sentence almost verbatim and would have matched
   * whether or not the panel rendered at all.
   */
  await page.route('**/auth/v1/resend*', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 429,
        error_code: 'over_email_send_rate_limit',
        msg: 'For security purposes, you can only request this after 51 seconds.',
      }),
    });
  });

  await page.getByRole('button', { name: 'Send it again' }).click();

  /*
   * Scoped to the callout deliberately. The toast renders the same sentence,
   * so an unscoped match passes with the panel gone entirely -- verified by
   * removing it, which left this green. Asserting "it is on the page
   * somewhere" is precisely the standard that let a corner toast count as
   * telling the customer something.
   */
  await expect(
    page.locator('.clean-auth-callout').getByText(/you can only request this after 51 seconds/),
  ).toBeVisible();

  // Still the confirmation state, not bounced back to a form by the failure.
  await expect(page.getByRole('button', { name: 'Create Account' })).toHaveCount(0);
});

test('the confirmation state hands back a way to correct the address', async ({ page }) => {
  await page.route('**/auth/v1/signup*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...userRecord(), identities: [] }),
    });
  });
  await stubGoTrueUser(page);

  await page.goto('/app/login?mode=signup');
  await page.getByLabel('Email or User ID').fill('typo@xbar.test');
  await page.getByLabel('Password', { exact: true }).fill('a-brand-new-password');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByRole('heading', { name: 'Check typo@xbar.test' })).toBeVisible({ timeout: 30_000 });

  /*
   * A mistyped address is the likeliest reason the email never arrives, and
   * from a screen with no form there is otherwise nothing to do about it but
   * start over. This has to actually return to signup rather than merely
   * exist.
   */
  await page.getByRole('button', { name: 'Use a different address' }).click();

  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  // Still on signup, and the address is there to be corrected rather than
  // retyped from scratch.
  await expect(page.getByLabel('Email or User ID')).toHaveValue('typo@xbar.test');

  /*
   * The password does NOT come back with it. It was accepted and the screen
   * moved on to an inbox, so leaving it in the field means the credential sits
   * in an unsubmitted form for as long as the tab is open.
   */
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');

  // Which also means it cannot be resubmitted without retyping it -- the
  // button stays disabled on the cleared password, not merely blank-looking.
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeDisabled();

  // And the other way out still works.
  await page.getByLabel('Password', { exact: true }).fill('a-brand-new-password');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByRole('heading', { name: 'Check typo@xbar.test' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Check / })).toHaveCount(0);
});
