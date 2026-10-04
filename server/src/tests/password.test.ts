import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../lib/password';

test('verifyPassword returns false for malformed scrypt cost parameters', async () => {
  const password = 'StrongPass123!';
  const stored = await hashPassword(password);
  const parts = stored.split('$');
  assert.equal(parts.length, 6);
  parts[1] = 'not-a-number';

  assert.equal(await verifyPassword(password, parts.join('$')), false);
});
