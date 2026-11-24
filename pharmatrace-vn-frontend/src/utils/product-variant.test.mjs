import assert from 'node:assert/strict';
import test from 'node:test';
import { pickDisplayedVariant } from './product-variant.ts';

const blister = { id: 773, unitName: 'Blister Pack' };
const box = { id: 781, unitName: 'Box' };

test('sells the base unit the card shows even when the options list starts with another unit (B7)', () => {
  const product = { packaging: { id: 773 }, packagingOptions: [box, blister] };
  assert.equal(pickDisplayedVariant(product), blister);
});

test('uses the base unit when it is already first', () => {
  assert.equal(pickDisplayedVariant({ packaging: { id: 773 }, packagingOptions: [blister, box] }), blister);
});

test('an explicit variant always wins', () => {
  assert.equal(pickDisplayedVariant({ packaging: { id: 773 }, packagingOptions: [blister, box] }, box), box);
});

test('falls back to the first option when the base unit is unknown or missing from the list', () => {
  assert.equal(pickDisplayedVariant({ packaging: null, packagingOptions: [box, blister] }), box);
  assert.equal(pickDisplayedVariant({ packaging: { id: 1 }, packagingOptions: [box, blister] }), box);
});

test('returns undefined when the product has no options', () => {
  assert.equal(pickDisplayedVariant({ packaging: { id: 773 }, packagingOptions: [] }), undefined);
  assert.equal(pickDisplayedVariant({}), undefined);
});

test('shows the unit that has stock when the base unit has none (Panadol: stock is under Box)', () => {
  const product = { packaging: { id: 773 }, packagingOptions: [{ ...blister, stock: 0 }, { ...box, stock: 97 }] };
  assert.equal(pickDisplayedVariant(product).id, 781);
});

test('keeps the base unit when it has stock or its stock is unknown', () => {
  assert.equal(pickDisplayedVariant({ packaging: { id: 773 }, packagingOptions: [{ ...box, stock: 5 }, { ...blister, stock: 2 }] }).id, 773);
  assert.equal(pickDisplayedVariant({ packaging: { id: 773 }, packagingOptions: [box, blister] }), blister);
});

test('falls back to the base unit when nothing has stock', () => {
  const product = { packaging: { id: 773 }, packagingOptions: [{ ...box, stock: 0 }, { ...blister, stock: 0 }] };
  assert.equal(pickDisplayedVariant(product).id, 773);
});
