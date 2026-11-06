import { describe, expect, it } from 'vitest';
import { OTHER_VERTICAL_WORDS } from '../src/grader.js';

describe('other-vertical wording', () => {
  const restaurant = OTHER_VERTICAL_WORDS.restaurant as RegExp;

  it.each([
    "And the patient's date of birth?",
    'Aapka appointment confirm hai',
    'यह मरीज़ की जन्मतिथि है',
    'Please book with the doctor',
    'Smile Dental Care',
  ])('flags clinic words a restaurant guest must not hear: %s', (said) => {
    expect(restaurant.test(said)).toBe(true);
  });

  it.each([
    'Done. Riya Bhatt’s table is booked at Table 1 (window) on Tuesday, 13 October at 8 pm.',
    'Kya main aapko waitlist mein daal doon? Table khaali hote hi hum aapko call karenge.',
    'I can’t advise on allergies or ingredients. Our staff can help with that.',
    '12 Church Road, Pune, near the address board.',
  ])('lets ordinary restaurant replies through: %s', (said) => {
    expect(restaurant.test(said)).toBe(false);
  });
});
