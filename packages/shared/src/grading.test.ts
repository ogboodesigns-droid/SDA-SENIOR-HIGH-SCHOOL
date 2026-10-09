import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GRADING_SCALE, gpaFor, gradeFor, isPass, roundGpa } from './grading';
import { hasPermission } from './permissions';

test('gradeFor picks the band whose lower bound the total reaches', () => {
  assert.equal(gradeFor(100, DEFAULT_GRADING_SCALE).grade, 'A1');
  assert.equal(gradeFor(80, DEFAULT_GRADING_SCALE).grade, 'A1');
  assert.equal(gradeFor(79.5, DEFAULT_GRADING_SCALE).grade, 'B2');
  assert.equal(gradeFor(69, DEFAULT_GRADING_SCALE).grade, 'B3');
  assert.equal(gradeFor(64, DEFAULT_GRADING_SCALE).grade, 'C4');
  assert.equal(gradeFor(50, DEFAULT_GRADING_SCALE).grade, 'C6');
  assert.equal(gradeFor(70, DEFAULT_GRADING_SCALE).grade, 'B2');
  assert.equal(gradeFor(45, DEFAULT_GRADING_SCALE).grade, 'D7');
  assert.equal(gradeFor(44, DEFAULT_GRADING_SCALE).points, 8);
  assert.equal(gradeFor(39, DEFAULT_GRADING_SCALE).grade, 'F9');
  assert.equal(gradeFor(0, DEFAULT_GRADING_SCALE).grade, 'F9');
});

test("transcript GPA and credits, worked as on the school's sample transcript", () => {
  assert.equal(gpaFor('A1', DEFAULT_GRADING_SCALE), 4);
  assert.equal(gpaFor('C6', DEFAULT_GRADING_SCALE), 1.5);
  assert.equal(gpaFor('F9', DEFAULT_GRADING_SCALE), 0);
  assert.equal(isPass('E8', DEFAULT_GRADING_SCALE), true);
  assert.equal(isPass('F9', DEFAULT_GRADING_SCALE), false);
  // 42 subject-semesters adding up to 64.5 grade points → cumulative GPA 1.5.
  assert.equal(roundGpa(64.5 / 42), 1.5);
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
