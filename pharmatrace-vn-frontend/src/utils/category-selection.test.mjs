import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionState, toggleCategorySelection, topSelectedIds } from './category-selection.ts';

// 1 Medicine cabinet (11 Pain, 12 Cold), 2 Vitamins (no children), 3 Care (31 Eye -> 311 Drops)
const tree = [
  { id: 1, children: [{ id: 11 }, { id: 12 }] },
  { id: 2 },
  { id: 3, children: [{ id: 31, children: [{ id: 311 }] }] },
];
const sorted = (ids) => [...ids].sort();

test('selecting a parent selects every child (B1)', () => {
  assert.deepEqual(sorted(toggleCategorySelection(tree, [], 1)), ['1', '11', '12']);
  assert.equal(selectionState(tree, ['1', '11', '12'], 1), 'checked');
});

test('clearing one child leaves the parent partially selected', () => {
  const ids = toggleCategorySelection(tree, ['1', '11', '12'], 11);
  assert.deepEqual(sorted(ids), ['12']);
  assert.equal(selectionState(tree, ids, 1), 'partial');
  assert.equal(selectionState(tree, ids, 12), 'checked');
  assert.equal(selectionState(tree, ids, 11), 'none');
});

test('selecting the last missing child selects the parent', () => {
  const ids = toggleCategorySelection(tree, ['12'], 11);
  assert.deepEqual(sorted(ids), ['1', '11', '12']);
  assert.equal(selectionState(tree, ids, 1), 'checked');
});

test('clearing a fully selected parent clears all of its children', () => {
  assert.deepEqual(toggleCategorySelection(tree, ['1', '11', '12'], 1), []);
});

test('selecting a partially selected parent completes it', () => {
  assert.deepEqual(sorted(toggleCategorySelection(tree, ['12'], 1)), ['1', '11', '12']);
});

test('a category without children toggles by itself', () => {
  assert.deepEqual(toggleCategorySelection(tree, [], 2), ['2']);
  assert.deepEqual(toggleCategorySelection(tree, ['2'], 2), []);
});

test('works through several levels', () => {
  const all = sorted(toggleCategorySelection(tree, [], 3));
  assert.deepEqual(all, ['3', '31', '311']);
  const cleared = toggleCategorySelection(tree, all, 311);
  assert.deepEqual(cleared, []);
  assert.equal(selectionState(tree, ['311'], 3), 'checked');
});

test('an old parent-only link means the whole branch and can be narrowed', () => {
  assert.equal(selectionState(tree, ['1'], 1), 'checked');
  assert.equal(selectionState(tree, ['1'], 11), 'checked');
  const ids = toggleCategorySelection(tree, ['1'], 11);
  assert.deepEqual(sorted(ids), ['12']);
});

test('keeps unrelated selections when toggling', () => {
  assert.deepEqual(sorted(toggleCategorySelection(tree, ['2'], 1)), ['1', '11', '12', '2']);
});

test('filter tags show the parent instead of every child', () => {
  assert.deepEqual(topSelectedIds(tree, ['1', '11', '12']), ['1']);
  assert.deepEqual(topSelectedIds(tree, ['12']), ['12']);
  assert.deepEqual(topSelectedIds(tree, ['1', '11', '12', '2']), ['1', '2']);
});
