#!/usr/bin/env node

// Test that the updated regex patterns work correctly
const testIds = [
  'ENG-123',      // Should pass - traditional format
  'B2BPROD-206',  // Should pass - alphanumeric prefix
  'B2B-456',      // Should pass - alphanumeric prefix
  'TEST1-789',    // Should pass - alphanumeric prefix
  '123ABC-456',   // Should pass - starts with number
  'ABC',          // Should fail - no hyphen
  'ABC-',         // Should fail - no number after hyphen
  'ABC-XYZ',      // Should fail - letters after hyphen
  '-123',         // Should fail - no prefix
];

const regex = /^[A-Za-z0-9]+-\d+$/i;

console.log('Testing Linear Issue ID regex: /^[A-Za-z0-9]+-\\d+$/i\n');

testIds.forEach(id => {
  const valid = regex.test(id);
  const symbol = valid ? '✓' : '✗';
  const status = valid ? 'PASS' : 'FAIL';
  console.log(`${symbol} ${id.padEnd(15)} - ${status}`);
});