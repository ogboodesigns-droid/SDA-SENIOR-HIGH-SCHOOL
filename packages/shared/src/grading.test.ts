import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GRADING_SCALE, gradeFor } from './grading';
import { hasPermission } from './permissions';

test('gradeFor picks the band whose lower bound the total reaches', () => {
  assert.equal(gradeFor(100, DEFAULT_GRADING_SCALE).grade, 'A1');
  assert.equal(gradeFor(75, DEFAULT_GRADING_SCALE).grade, 'A1');
  assert.equal(gradeFor(74.5, DEFAULT_GRADING_SCALE).grade, 'B2');
  assert.equal(gradeFor(70, DEFAULT_GRADING_SCALE).grade, 'B2');
  assert.equal(gradeFor(45, DEFAULT_GRADING_SCALE).grade, 'D7');
  assert.equal(gradeFor(44, DEFAULT_GRADING_SCALE).points, 8);
  assert.equal(gradeFor(39, DEFAULT_GRADING_SCALE).grade, 'F9');
  assert.equal(gradeFor(0, DEFAULT_GRADING_SCALE).grade, 'F9');
});

test('gradeFor does not depend on scale order', () => {
  const reversed = [...DEFAULT_GRADING_SCALE].reverse();
  assert.equal(gradeFor(66, reversed).grade, 'B3');
});

test('students and parents hold no management permissions', () => {
  assert.equal(hasPermission('student', 'results:enter'), false);
  assert.equal(hasPermission('parent', 'announcements:publish'), false);
  assert.equal(hasPermission('teacher', 'results:publish'), false);
  assert.equal(hasPermission('head', 'results:publish'), true);
});
