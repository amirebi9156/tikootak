// تست قواعد تپ/دابل‌کلیک Q3 (بدون DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenMessageMenu, canReplyOnDoubleClick } from '../../web-src/src/msgGestures.js';

test('tap opens menu only within 8px and 400ms', () => {
  assert.equal(canOpenMessageMenu({ id: 'p1', dx: 5, dy: 5, dt: 300 }), true);
  assert.equal(canOpenMessageMenu({ id: 'p1', dx: 9, dy: 0, dt: 300 }), false);
  assert.equal(canOpenMessageMenu({ id: 'p1', dx: 0, dy: 0, dt: 401 }), false);
});

test('tap does not open on selection, multi-select, interactive target or pending event', () => {
  assert.equal(canOpenMessageMenu({ id: 'p1', selection: 'متن' }), false);
  assert.equal(canOpenMessageMenu({ id: 'p1', multi: true }), false);
  assert.equal(canOpenMessageMenu({ id: 'p1', interactive: true }), false);
  assert.equal(canOpenMessageMenu({ id: '~pending' }), false);
});

test('double-click replies unless text was selected before / target interactive / multi', () => {
  assert.equal(canReplyOnDoubleClick({ id: 'p1' }), true);
  assert.equal(canReplyOnDoubleClick({ id: 'p1', selectionBefore: 'متن انتخاب‌شده' }), false);
  assert.equal(canReplyOnDoubleClick({ id: 'p1', interactive: true }), false);
  assert.equal(canReplyOnDoubleClick({ id: 'p1', multi: true }), false);
});
