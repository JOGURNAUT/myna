export const LANG_LABEL: Record<string, string> = { en: 'EN', hi: 'HI', hinglish: 'Hinglish' };
export const LANG_GLYPH: Record<string, string> = { en: 'Aa', hi: 'अ', hinglish: 'Aअ' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `2026-10-14T16:30` → `Wed, 14 Oct · 4:30 pm` (business-local, no time-zone maths). */
export function when(local: string): string {
  const [date = '', time = ''] = local.split('T');
  return `${day(date)} · ${clock(time)}`;
}

export function day(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()] ?? ''}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ''}`;
}

export function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

export function duration(sec: number | null): string {
  if (sec === null) return '—';
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
}

export const pct = (rate: number) => `${Math.round(rate * 100)}%`;

/** Replies take milliseconds in text mode: say so instead of rounding to "0.0 s". */
export const latency = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

export const CATEGORY_LABEL: Record<string, string> = {
  report_status: 'Report status',
  medicine_refill_request: 'Medicine refill',
  billing_question: 'Billing',
  doctor_callback: 'Doctor call-back',
  directions_timings: 'Directions / timings',
  other: 'Other',
};

export const HANDOFF_LABEL: Record<string, string> = {
  emergency: 'Emergency',
  medical_question: 'Medical question',
  low_confidence: 'Low confidence',
  frustrated: 'Caller frustrated',
  repeated_misunderstanding: "Couldn't understand the caller",
  caller_asked: 'Caller asked for a person',
  kill_switch: 'Kill switch on',
  tool_failure: 'System error',
  verification_failed: "Couldn't verify the patient",
  unanswered_question: 'Question the clinic left blank',
};

export const OUTCOME_LABEL: Record<string, string> = {
  booked: 'Booked',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
  message_taken: 'Message taken',
  handoff: 'Handed to staff',
  no_action: 'No action',
};

export const FAILURE_TYPES: [string, string][] = [
  ['wrong_date_or_time', 'Wrong date or time'],
  ['wrong_patient_or_doctor', 'Wrong patient or doctor'],
  ['misheard', 'Misheard the caller'],
  ['should_have_handed_off', 'Should have handed to staff'],
  ['disclosed_too_much', 'Gave information it should not have'],
  ['tool_or_booking_error', 'Tool or booking error'],
  ['too_slow_or_talked_over', 'Too slow or talked over the caller'],
  ['other', 'Other'],
];
