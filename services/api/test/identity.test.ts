import { describe, expect, it } from 'vitest';
import { nameKey, transliterate } from '../src/core/identity.js';

describe('transliterate (Devanagari → Latin)', () => {
  it.each([
    ['राहुल', 'raahul'],
    ['गुप्ता', 'guptaa'],
    ['पूजा', 'poojaa'],
    ['मल्होत्रा', 'malhotraa'],
    ['शर्मा', 'sharmaa'],
    ['फ़राह', 'faraah'],
  ])('%s → %s', (hi, latin) => {
    expect(transliterate(hi)).toBe(latin);
  });
});

describe('nameKey: the same person however the name arrives', () => {
  it.each([
    ['Pooja Malhotra', 'पूजा मल्होत्रा'],
    ['Pooja Malhotra', 'Puja Malhotra'],
    ['Rahul Gupta', 'राहुल गुप्ता'],
    ['Arjun Verma', 'अर्जुन वर्मा'],
    ['Sunita Sharma', 'सुनीता शर्मा'],
    ['Neha Kapoor', 'नेहा कपूर'],
    ['Leela Iyer', 'लीला अय्यर'],
    ['Pooja Malhotra', 'Malhotra Pooja ji'],
    ['Pooja Malhotra', 'श्रीमती पूजा मल्होत्रा'],
  ])('%s ≈ %s', (a, b) => {
    expect(nameKey(a)).toBe(nameKey(b));
  });

  it.each([
    ['Pooja Malhotra', 'Priya Malhotra'],
    ['Pooja Malhotra', 'Pooja'],
    ['Meera Nair', 'Kavya Nair'],
    ['Rahul Gupta', 'Rahul Sharma'],
  ])('%s ≠ %s', (a, b) => {
    expect(nameKey(a)).not.toBe(nameKey(b));
  });
});
