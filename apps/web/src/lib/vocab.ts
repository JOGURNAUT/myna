/**
 * Words for the public demo, per vertical. The agent's replies come from fixed templates in the
 * agent service; this is only the page copy around them.
 */
export type DemoKind = 'clinic' | 'restaurant';

export interface Vocab {
  tab: string;
  intro: string;
  suggestions: string[];
  can: string[];
  wont: string[];
  handoff: string;
  booked: string;
  scheduleLabel: string;
  resourceHeading: string;
  disclaimer: string;
}

export const VOCAB: Record<DemoKind, Vocab> = {
  clinic: {
    tab: 'Dental clinic',
    intro:
      'She answers the phone for a small dental clinic. Speak or type in English, Hindi or Hinglish. Try booking a cleaning with Dr. Mehta.',
    suggestions: [
      'Mujhe cleaning ka appointment chahiye kal subah',
      'I need a consultation with Dr. Rao on Wednesday',
      'मुझे अपना अपॉइंटमेंट बदलना है',
      'What are your timings?',
    ],
    can: [
      'Book, move and cancel appointments',
      'Answer clinic timings, fees and directions',
      'Take a message and promise a staff call-back',
      'Call patients the day before to confirm',
    ],
    wont: [
      'Give medical advice or suggest medicines',
      'Guess answers the clinic hasn’t given her',
      'Share one patient’s details with another caller',
      'Pretend to be a person: she says she’s an assistant',
    ],
    handoff: 'Myna passed this call to the clinic staff.',
    booked: 'Your appointment now shows on the schedule.',
    scheduleLabel: 'The clinic’s schedule',
    resourceHeading: 'Doctor',
    disclaimer: 'The demo clinic and its patients are fictional.',
  },
  restaurant: {
    tab: 'Restaurant',
    intro:
      'She answers the phone for a sit-down restaurant. Speak or type in English, Hindi or Hinglish. Try booking a table for four tomorrow at 8 pm, or ask for the waitlist when it is full.',
    suggestions: [
      'Kal raat 8 baje 4 logon ke liye table chahiye',
      'Table for two on Friday at 1 pm',
      'मुझे अपनी बुकिंग कैंसल करनी है',
      'What are your timings?',
    ],
    can: [
      'Book, move and cancel tables by party size',
      'Answer timings, parking and the menu details the restaurant gave her',
      'Put a guest on the waitlist and call when a table opens',
      'Take a message for the staff',
    ],
    wont: [
      'Answer allergy or ingredient questions: staff do that',
      'Guess answers the restaurant hasn’t given her',
      'Share one guest’s booking with another caller',
      'Pretend to be a person: she says she’s an assistant',
    ],
    handoff: 'Myna passed this call to the restaurant staff.',
    booked: 'Your table now shows on the schedule.',
    scheduleLabel: 'The restaurant’s tables',
    resourceHeading: 'Table',
    disclaimer: 'The demo restaurant and its guests are fictional.',
  },
};
