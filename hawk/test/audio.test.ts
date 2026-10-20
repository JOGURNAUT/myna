import { describe, expect, it } from 'vitest';
import { cer, LoopbackAudio, sameName } from '../src/audio.js';
import { mentionsName } from '../src/simulator.js';

describe('audio mode helpers', () => {
  it('measures character error rate', () => {
    expect(cer('My name is Neha Kapoor', 'My name is Neha Kapoor.')).toBe(0);
    expect(cer('My name is Neha Kapoor', 'My name is Deha Kapoor')).toBeCloseTo(1 / 22, 2);
    expect(cer('abc', '')).toBe(1);
  });

  it('treats a spelling variant as the same person but one wrong letter in a short name as not', () => {
    expect(sameName('Kamala Devi', 'Kamla Devi')).toBe(true);
    expect(sameName('Neha Kapoor', 'Deha Kapoor')).toBe(false);
    expect(sameName('Neha Kapoor', 'Neha')).toBe(false);
  });

  it('notices a read-back with the wrong name, like a caller who is listening', () => {
    expect(mentionsName('Done. Neha Kapoor is booked with Dr. Mehta.', 'Neha Kapoor')).toBe(true);
    expect(mentionsName('Done. Deha Kapoor is booked with Dr. Mehta.', 'Neha Kapoor')).toBe(false);
    expect(mentionsName('कमला देवी के लिए बुक है', 'कमला देवी')).toBe(true);
  });

  it('has a loopback channel that returns the words unchanged', async () => {
    const heard = await new LoopbackAudio().roundTrip('hello');
    expect(heard.heard).toBe('hello');
  });
});

describe('names written with or without a space', () => {
  it('matches Devanagari spellings that differ only by the space', () => {
    expect(sameName('मोहन लाल', 'मोहनलाल')).toBe(true);
  });
});
