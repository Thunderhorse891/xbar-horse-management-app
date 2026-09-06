import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFLINE_MESSAGE, describeAuthError } from '../src/lib/authErrors.js';

/*
 * The sign-in form shows whatever Supabase said. That is right for a rejection
 * and wrong for a dropped connection: a customer who reads "Failed to fetch"
 * under a password field concludes the password was wrong, and retypes it.
 */

test('a browser transport failure is described as a connection problem', () => {
  for (const raw of [
    'Failed to fetch',
    'TypeError: Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'net::ERR_INTERNET_DISCONNECTED',
  ]) {
    assert.equal(describeAuthError(raw), OFFLINE_MESSAGE, `${raw} should read as a connection problem`);
  }
});

test('a real auth rejection is passed through word for word', () => {
  // These are the messages that tell the customer what to actually do, and a
  // friendlier paraphrase would destroy the information in them.
  for (const raw of [
    'Invalid login credentials',
    'Email not confirmed',
    'User already registered',
    'Password should be at least 6 characters',
    'Unsupported provider: provider is not enabled',
    'For security purposes, you can only request this after 60 seconds.',
  ]) {
    assert.equal(describeAuthError(raw), raw);
  }
});

test('an empty message becomes something rather than a blank panel', () => {
  assert.equal(describeAuthError(''), 'Something went wrong. Try again.');
  assert.equal(describeAuthError('   '), 'Something went wrong. Try again.');
});

test('the offline message names the fix, not the symptom', () => {
  // It has to tell someone what to do; "network error" restates the failure.
  assert.match(OFFLINE_MESSAGE, /connection/i);
});
