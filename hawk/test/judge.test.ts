import { describe, expect, it } from 'vitest';
import {
  agreement,
  buildPrompt,
  type JudgeModel,
  judgeTranscript,
  MIN_LABELLED_CALLS,
} from '../src/judge.js';
import { buildReport, summariseSoft } from '../src/report.js';
import type { GradedCall } from '../src/grader.js';

const turns = [
  { speaker: 'agent' as const, text: 'Namaste, main Myna hoon.' },
  { speaker: 'caller' as const, text: 'Mujhe kal appointment chahiye' },
];

const good = JSON.stringify({
  politeness: { pass: true, reason: 'Courteous.' },
  language: { pass: true, reason: 'Stayed in Hinglish.' },
  clarity: { pass: false, reason: 'Asked two things at once.' },
  overall_ok: true,
});

function fake(...replies: (string | Error)[]): JudgeModel & { calls: number } {
  const q = [...replies];
  return {
    name: 'fake',
    calls: 0,
    complete() {
      this.calls++;
      const next = q.shift();
      if (next === undefined) return Promise.reject(new Error('no more replies'));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

describe('judgeTranscript', () => {
  it('parses a valid verdict, even when the model wraps it in prose', async () => {
    const m = fake(`Here you go:\n${good}\nHope that helps.`);
    const s = await judgeTranscript(m, turns, 'hinglish');
    expect(s?.clarity).toEqual({ pass: false, reason: 'Asked two things at once.' });
    expect(s?.overallOk).toBe(true);
  });

  it('retries once on a malformed reply, then gives up with null (never a pass)', async () => {
    expect(await judgeTranscript(fake('not json', good), turns, 'en')).not.toBeNull();
    const m = fake('nope', '{"politeness":1}');
    expect(await judgeTranscript(m, turns, 'en')).toBeNull();
    expect(m.calls).toBe(2);
  });

  it('survives a transport failure and an empty transcript', async () => {
    expect(await judgeTranscript(fake(new Error('503'), new Error('503')), turns, 'en')).toBeNull();
    const m = fake(good);
    expect(await judgeTranscript(m, [], 'en')).toBeNull();
    expect(m.calls).toBe(0);
  });

  it('puts the transcript in the prompt as data, labelled by speaker', () => {
    const p = buildPrompt(turns, 'hinglish');
    expect(p).toContain('MYNA: Namaste');
    expect(p).toContain('CALLER: Mujhe kal');
    expect(p).toContain('hinglish');
  });
});

describe('agreement with human labels', () => {
  const pairs = [
    { callId: 'a', human: true, judge: true },
    { callId: 'b', human: false, judge: false },
    { callId: 'c', human: false, judge: true },
    { callId: 'd', human: true, judge: false },
  ];

  it('computes agreement, catch rate and precision, and lists the disagreements', () => {
    const a = agreement(pairs, 'fake', new Date('2026-10-27T00:00:00Z'));
    expect(a.n).toBe(4);
    expect(a.agreement).toBe(0.5);
    expect(a.catchRate).toBe(0.5); // humans marked b and c wrong; the judge flagged only b
    expect(a.precision).toBe(0.5); // the judge flagged b and d; humans agreed about b
    expect(a.disagreements).toEqual(['c', 'd']);
  });

  it('is null, not 0%, when there is nothing to compare', () => {
    const a = agreement([], 'fake', new Date());
    expect(a.agreement).toBeNull();
    expect(a.catchRate).toBeNull();
    expect(MIN_LABELLED_CALLS).toBeGreaterThan(1);
  });
});

describe('soft scores in the report', () => {
  const call = (id: string, language: string): GradedCall =>
    ({
      record: { scenarioId: id, language, flow: 'booking', type: 't', turns: [], events: [] },
      checks: [],
      passed: true,
      endedWithPerson: false,
      worst: null,
    }) as unknown as GradedCall;

  it('counts unjudged calls separately and never as passes', () => {
    const a = call('a', 'en');
    const b = call('b', 'hi');
    const soft = summariseSoft(
      [a, b],
      new Map([
        [
          a,
          {
            politeness: { pass: true, reason: '' },
            language: { pass: true, reason: '' },
            clarity: { pass: false, reason: 'long' },
            overallOk: true,
          },
        ],
        [b, null],
      ]),
      'fake',
    );
    expect(soft.judged).toBe(1);
    expect(soft.unjudged).toBe(1);
    expect(soft.criteria.clarity).toEqual({ passed: 0, total: 1 });
    expect(soft.flagged[0]?.reasons).toEqual(['clarity: long']);
    const report = buildReport([a, b], {
      runId: 'x',
      clinic: 'c',
      clock: 'c',
      nlu: 'n',
      patient: 'p',
      soft,
    });
    expect(report.setup.judge).toContain('never changes a verdict');
    expect(report.flows.booking?.passRate).toBe(1); // the judge cannot move a verdict
  });
});
