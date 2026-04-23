const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCsvImportRow } = require('../lib/functions/bulk-import.js');

test('allows missing loan number when email is present', () => {
  const result = validateCsvImportRow(
    {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      vin: '1HGCM82633A004352',
    },
    0,
  );

  assert.equal(result.error, null);
});

test('fails when both email and phone are missing', () => {
  const result = validateCsvImportRow(
    {
      firstName: 'Jane',
      lastName: 'Doe',
      vin: '1HGCM82633A004352',
    },
    0,
  );

  assert.equal(result.error, 'Row 1: email or phone required.');
});