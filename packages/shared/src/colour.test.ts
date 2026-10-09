import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textOn } from './colour';

test('dark text on the yellow house colour, white on red, blue and green', () => {
  assert.equal(textOn('#f2c200'), '#1a1a1a');
  assert.equal(textOn('#c8102e'), '#ffffff');
  assert.equal(textOn('#1f5fbf'), '#ffffff');
  assert.equal(textOn('#1e8e3e'), '#ffffff');
});
