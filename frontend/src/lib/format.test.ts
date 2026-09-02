import { describe, expect, it } from 'vitest';
import { describeDevice, humaniseKey } from './format';

describe('humaniseKey', () => {
  it('turns a camelCase field name into words', () => {
    expect(humaniseKey('registeredAccounts')).toBe('Registered accounts');
  });

  it('turns a snake_case field name into words', () => {
    expect(humaniseKey('licence_number')).toBe('Licence number');
  });

  it('handles a single word', () => {
    expect(humaniseKey('status')).toBe('Status');
  });

  it('keeps digits attached to the word they belong to', () => {
    expect(humaniseKey('q1Total')).toBe('Q1 total');
  });
});

describe('describeDevice', () => {
  it('names the browser and the platform', () => {
    const chromeOnWindows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    expect(describeDevice(chromeOnWindows)).toBe('Chrome on Windows');
  });

  it('picks Edge over the Chrome fragment Edge also sends', () => {
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
    expect(describeDevice(edge)).toBe('Edge on Windows');
  });

  it('picks Safari only when no other browser claims the string', () => {
    const safariOnMac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(describeDevice(safariOnMac)).toBe('Safari on macOS');
  });

  it('returns nothing when there is no user agent to describe', () => {
    expect(describeDevice(null)).toBeNull();
    expect(describeDevice('')).toBeNull();
  });

  it('says so rather than guessing when the string is unrecognised', () => {
    expect(describeDevice('curl/8.4.0')).toBe('Unknown device');
  });
});
