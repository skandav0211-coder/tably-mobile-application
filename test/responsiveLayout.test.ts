import test from 'node:test';
import assert from 'node:assert/strict';
import { responsiveLayout } from '../src/core/responsiveLayout';

test('portrait phone keeps the bottom navigation and single-pane bill layout', () => {
  const layout = responsiveLayout(390, 844);
  assert.equal(layout.landscape, false);
  assert.equal(layout.rail, false);
  assert.equal(layout.twoPane, false);
  assert.equal(layout.compact, false);
});

test('short landscape phone uses compact controls, side navigation, and a two-pane bill', () => {
  const layout = responsiveLayout(800, 360);
  assert.equal(layout.landscape, true);
  assert.equal(layout.compact, true);
  assert.equal(layout.rail, true);
  assert.equal(layout.railWidth, 80);
  assert.equal(layout.twoPane, true);
  assert.equal(layout.cartWidth, 288);
});

test('narrow landscape remains usable without forcing a split bill pane', () => {
  const layout = responsiveLayout(533, 240);
  assert.equal(layout.rail, true);
  assert.equal(layout.twoPane, false);
  assert.equal(layout.compact, true);
  assert.ok(layout.width - layout.railWidth > 400);
});

test('portrait tablet keeps full-height controls and a navigation rail', () => {
  const layout = responsiveLayout(820, 1180);
  assert.equal(layout.landscape, false);
  assert.equal(layout.rail, true);
  assert.equal(layout.twoPane, false);
  assert.equal(layout.compact, false);
});
