import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '@e965/xlsx';
import { parseCsvRows, parseMenuRows, parseXlsxRows } from '../src/core/menuImport';

test('CSV parser supports quoted commas, escaped quotes, and embedded newlines', () => {
  assert.deepEqual(parseCsvRows('Item,Price,Size\r\n"Tea, Assam",25,"Small"\r\n"Tea ""Special""",30,"Large"\r\n"Two\nlines",5,'), [
    ['Item', 'Price', 'Size'],
    ['Tea, Assam', '25', 'Small'],
    ['Tea "Special"', '30', 'Large'],
    ['Two\nlines', '5', ''],
  ]);
  assert.throws(() => parseCsvRows('Item,Price\n"Tea,10'), /unclosed quoted field/i);
});

test('menu rows group sizes into one product and use the smallest size as the base price', () => {
  const result = parseMenuRows([
    ['Item', 'Category', 'SKU', 'Size', 'Price', 'Tax'],
    ['Coffee', 'Hot drinks', 'CF1', 'Large', '150', '5%'],
    ['Coffee', 'Hot drinks', 'CF1', 'Small', '100', '5%'],
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.products, [{
    name: 'Coffee', category: 'Hot drinks', sku: 'CF1', price: 100, taxRate: 5,
    variants: [{ name: 'Large', priceDelta: 50, kind: 'variant' }, { name: 'Small', priceDelta: 0, kind: 'variant' }],
  }]);
});

test('menu parser preserves an explicit base price and excludes conflicting groups', () => {
  const result = parseMenuRows([
    ['Name', 'Price', 'Size'],
    ['Tea', '40', ''],
    ['Tea', '50', 'Large'],
    ['Juice', '20', 'Small'],
    ['Juice', '30', 'Small'],
  ]);
  assert.deepEqual(result.products, [{
    name: 'Tea', category: null, sku: null, price: 40, taxRate: 0,
    variants: [{ name: 'Large', priceDelta: 10, kind: 'variant' }],
  }]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /duplicate size rows have different prices/i);
});

test('menu parser excludes separate items that reuse the same SKU', () => {
  const result = parseMenuRows([
    ['Item', 'SKU', 'Price'],
    ['Coffee', 'SKU-1', '50'],
    ['Tea', ' sku-1 ', '30'],
  ]);
  assert.equal(result.products.length, 0);
  assert.match(result.errors[0], /SKU SKU-1: used by multiple item groups/i);
});

test('XLSX first sheet is parsed using the same import rules', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Item', 'Price'], ['Cookie', 25]]), 'Menu');
  const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
  const parsed = parseMenuRows(parseXlsxRows(base64));
  assert.equal(parsed.products[0].name, 'Cookie');
  assert.equal(parsed.products[0].price, 25);
});
