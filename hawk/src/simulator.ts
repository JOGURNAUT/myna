import type { Event, Goal, Language, Persona, Scenario, When } from './schema.js';

/**
 * The scripted patient: answers whatever Myna is waiting for, from the scenario's goal, in
 * the run's language and the persona's style. Deterministic, so a scenario that fails keeps
 * failing the same way until the agent is fixed. (An LLM patient is the M3+ upgrade.)
 */

export interface AgentReply {
  text: string;
  state: string;
  expecting: string;
  ended: boolean;
}

type Phrases = Record<Language, string>;
const L = (en: string, hinglish: string, hi: string): Phrases => ({ en, hinglish, hi });

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTHS_HI = [
  'जनवरी',
  'फ़रवरी',
  'मार्च',
  'अप्रैल',
  'मई',
  'जून',
  'जुलाई',
  'अगस्त',
  'सितंबर',
  'अक्टूबर',
  'नवंबर',
  'दिसंबर',
];
const WEEKDAYS: Record<string, Phrases> = {
  monday: L('Monday', 'Monday', 'सोमवार'),
  tuesday: L('Tuesday', 'Tuesday', 'मंगलवार'),
  wednesday: L('Wednesday', 'Wednesday', 'बुधवार'),
  thursday: L('Thursday', 'Thursday', 'गुरुवार'),
  friday: L('Friday', 'Friday', 'शुक्रवार'),
  saturday: L('Saturday', 'Saturday', 'शनिवार'),
  sunday: L('Sunday', 'Sunday', 'रविवार'),
};
const SERVICES: Record<string, Phrases> = {
  cleaning: L('cleaning', 'cleaning', 'सफ़ाई'),
  consultation: L('consultation', 'checkup', 'चेकअप'),
  filling: L('filling', 'filling', 'फिलिंग'),
  'root-canal': L('root canal', 'root canal', 'रूट कैनाल'),
  'braces-review': L('braces review', 'braces checkup', 'ब्रेसेस चेकअप'),
};
const DOCTORS: Record<string, Phrases> = {
  'dr-mehta': L('with Dr. Mehta', 'Dr. Mehta ke saath', 'डॉक्टर मेहता के साथ'),
  'dr-rao': L('with Dr. Rao', 'Dr. Rao ke saath', 'डॉक्टर राव के साथ'),
};
const ORDINALS: [Phrases, Phrases, Phrases] = [
  L('the first one', 'pehla wala', 'पहला वाला'),
  L('the second one', 'doosra wala', 'दूसरा वाला'),
  L('the third one', 'teesra wala', 'तीसरा वाला'),
];
const EN_UNITS = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
function enWords(n: number): string {
  if (n < 20) return EN_UNITS[n] ?? String(n);
  const unit = n % 10;
  return `${EN_TENS[Math.floor(n / 10)] ?? ''}${unit ? ` ${EN_UNITS[unit] ?? ''}` : ''}`;
}
// Hindi 0–99, the spellings a careful speaker would produce (index = value).
const HI_ROMAN = [
  '',
  'ek',
  'do',
  'teen',
  'chaar',
  'paanch',
  'chhah',
  'saat',
  'aath',
  'nau',
  'das',
  'gyaarah',
  'baarah',
  'terah',
  'chaudah',
  'pandrah',
  'solah',
  'satrah',
  'athaarah',
  'unnees',
  'bees',
  'ikkees',
  'baaees',
  'teyees',
  'chaubees',
  'pachchees',
  'chhabbees',
  'sattaees',
  'atthaees',
  'untees',
  'tees',
  'iktees',
  'battees',
  'taintees',
  'chauntees',
  'paintees',
  'chhattees',
  'saintees',
  'adtees',
  'untaalees',
  'chaalees',
  'iktaalees',
  'bayaalees',
  'taintaalees',
  'chavaalees',
  'paintaalees',
  'chhiyaalees',
  'saintaalees',
  'adtaalees',
  'unchaas',
  'pachaas',
  'ikyaavan',
  'baavan',
  'tirpan',
  'chauvan',
  'pachpan',
  'chhappan',
  'sattaavan',
  'atthaavan',
  'unsath',
  'saath',
  'iksath',
  'baasath',
  'tirsath',
  'chausath',
  'painsath',
  'chhiyaasath',
  'sadsath',
  'adsath',
  'unhattar',
  'sattar',
  'ikhattar',
  'bahattar',
  'tihattar',
  'chauhattar',
  'pachhattar',
  'chhihattar',
  'sathattar',
  'athhattar',
  'unaasi',
  'assi',
  'ikyaasi',
  'bayaasi',
  'tiraasi',
  'chauraasi',
  'pachaasi',
  'chhiyaasi',
  'sataasi',
  'athaasi',
  'navaasi',
  'nabbe',
  'ikyaanave',
  'baanave',
  'tiraanave',
  'chauraanave',
  'pachaanave',
  'chhiyaanave',
  'sattaanave',
  'atthaanave',
  'ninyaanave',
];
const HI_DEVA = [
  '',
  'एक',
  'दो',
  'तीन',
  'चार',
  'पाँच',
  'छह',
  'सात',
  'आठ',
  'नौ',
  'दस',
  'ग्यारह',
  'बारह',
  'तेरह',
  'चौदह',
  'पंद्रह',
  'सोलह',
  'सत्रह',
  'अठारह',
  'उन्नीस',
  'बीस',
  'इक्कीस',
  'बाईस',
  'तेईस',
  'चौबीस',
  'पच्चीस',
  'छब्बीस',
  'सत्ताईस',
  'अट्ठाईस',
  'उनतीस',
  'तीस',
  'इकतीस',
  'बत्तीस',
  'तैंतीस',
  'चौंतीस',
  'पैंतीस',
  'छत्तीस',
  'सैंतीस',
  'अड़तीस',
  'उनतालीस',
  'चालीस',
  'इकतालीस',
  'बयालीस',
  'तैंतालीस',
  'चवालीस',
  'पैंतालीस',
  'छियालीस',
  'सैंतालीस',
  'अड़तालीस',
  'उनचास',
  'पचास',
  'इक्यावन',
  'बावन',
  'तिरपन',
  'चौवन',
  'पचपन',
  'छप्पन',
  'सत्तावन',
  'अट्ठावन',
  'उनसठ',
  'साठ',
  'इकसठ',
  'बासठ',
  'तिरसठ',
  'चौंसठ',
  'पैंसठ',
  'छियासठ',
  'सड़सठ',
  'अड़सठ',
  'उनहत्तर',
  'सत्तर',
  'इकहत्तर',
  'बहत्तर',
  'तिहत्तर',
  'चौहत्तर',
  'पचहत्तर',
  'छिहत्तर',
  'सतहत्तर',
  'अठहत्तर',
  'उन्यासी',
  'अस्सी',
  'इक्यासी',
  'बयासी',
  'तिरासी',
  'चौरासी',
  'पचासी',
  'छियासी',
  'सत्तासी',
  'अट्ठासी',
  'नवासी',
  'नब्बे',
  'इक्यानवे',
  'बानवे',
  'तिरानवे',
  'चौरानवे',
  'पचानवे',
  'छियानवे',
  'सत्तानवे',
  'अट्ठानवे',
  'निन्यानवे',
];

export function sayDay(day: string, lang: Language): string {
  const d = day.toLowerCase();
  if (d === 'tomorrow') return L('tomorrow', 'kal', 'कल')[lang];
  if (d === 'today') return L('today', 'aaj', 'आज')[lang];
  if (d === 'next week') return L('next week', 'agle hafte', 'अगले हफ्ते')[lang];
  const next = d.startsWith('next ');
  const wd = WEEKDAYS[next ? d.slice(5) : d];
  if (wd) {
    const prefix = next ? L('next ', 'agle ', 'अगले ')[lang] : '';
    return `${prefix}${wd[lang]}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) {
    const day_ = Number(m[3]);
    const month = Number(m[2]) - 1;
    return lang === 'hi' ? `${day_} ${MONTHS_HI[month]}` : `${day_} ${MONTHS_EN[month]}`;
  }
  return day;
}

export function sayTime(time: string, lang: Language): string {
  const pods: Record<string, Phrases> = {
    morning: L('in the morning', 'subah', 'सुबह'),
    afternoon: L('in the afternoon', 'dopahar mein', 'दोपहर में'),
    evening: L('in the evening', 'shaam ko', 'शाम को'),
  };
  const pod = pods[time];
  if (pod) return pod[lang];
  const [hRaw, mRaw] = time.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw ?? 0);
  const h12 = h % 12 || 12;
  const clock = m ? `${h12}:${String(m).padStart(2, '0')}` : `${h12}`;
  if (lang === 'en') return `at ${clock} ${h < 12 ? 'am' : 'pm'}`;
  const part =
    h < 12 ? L('', 'subah', 'सुबह') : h < 17 ? L('', 'dopahar', 'दोपहर') : L('', 'shaam', 'शाम');
  return lang === 'hi' ? `${part.hi} ${clock} बजे` : `${part.hinglish} ${clock} baje`;
}

export function sayWhen(when: When, lang: Language): string {
  return [when.day ? sayDay(when.day, lang) : '', when.time ? sayTime(when.time, lang) : '']
    .filter(Boolean)
    .join(' ');
}

function sayDob(iso: string, style: Persona['dobStyle'], lang: Language): string {
  const [y, mo, d] = iso.split('-').map(Number) as [number, number, number];
  if (style === 'numeric')
    return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
  if (style === 'words') {
    // How people actually say it — and what a date parser must survive.
    if (lang === 'en') {
      const year =
        y >= 2000 ? `two thousand ${enWords(y - 2000)}` : `nineteen ${enWords(y - 1900)}`;
      return `${enWords(d)} ${MONTHS_EN[mo - 1] ?? ''} ${year}`.replace(/\s+/g, ' ').trim();
    }
    const table = lang === 'hi' ? HI_DEVA : HI_ROMAN;
    const [sau, hazaar] = lang === 'hi' ? ['सौ', 'हज़ार'] : ['sau', 'hazaar'];
    const month = lang === 'hi' ? MONTHS_HI[mo - 1] : MONTHS_EN[mo - 1];
    const year =
      y >= 2000
        ? `${table[2] ?? ''} ${hazaar} ${table[y - 2000] ?? ''}`
        : `${table[19] ?? ''} ${sau} ${table[y - 1900] ?? ''}`;
    return `${table[d] ?? d} ${month ?? ''} ${year}`.replace(/\s+/g, ' ').trim();
  }
  return lang === 'hi'
    ? `${d} ${MONTHS_HI[mo - 1] ?? ''} ${y}`
    : `${d} ${MONTHS_EN[mo - 1] ?? ''} ${y}`;
}

function sayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

const YES = L('Yes, please.', 'Haan ji.', 'हाँ जी।');
const BYE = L("No, that's all. Thank you.", 'Nahi, bas. Thank you.', 'नहीं, बस। धन्यवाद।');
const DONT_KNOW = L("I don't know it.", 'Pata nahi.', 'पता नहीं।');
const RAMBLE = L('Hmm, okay, let me think... ', 'Haan ji, ek second... ', 'हाँ जी, एक सेकंड... ');

const EVENT_LINES = {
  emergency: L(
    "Wait, there's a lot of blood, it won't stop bleeding!",
    'Ruko, bahut khoon aa raha hai, ruk nahi raha!',
    'रुकिए, बहुत खून आ रहा है, रुक नहीं रहा!',
  ),
  ask_medical: L(
    'Before that, which painkiller should I take?',
    'Pehle yeh bataiye, dard ke liye kaunsi dawai lun?',
    'पहले बताइए, दर्द के लिए कौन सी दवा लूँ?',
  ),
  ask_staff: L(
    'Can I talk to the staff, please?',
    'Staff se baat karni hai.',
    'स्टाफ से बात करनी है।',
  ),
};

export class ScriptedPatient {
  private turn = 0;
  private changedMind = false;
  private namedOnce = false;

  constructor(
    private readonly scenario: Scenario,
    private readonly persona: Persona,
    private readonly lang: Language,
  ) {}

  /** The caller's next utterance, or null when the call is over. */
  respond(reply: AgentReply): string | null {
    if (reply.ended) return null;
    this.turn += 1;
    const forced = this.eventAt(this.turn);
    if (forced) return forced;
    return this.answer(reply.expecting);
  }

  private eventAt(turn: number): string | null {
    for (const e of this.scenario.events) {
      if (!('atTurn' in e) || e.atTurn !== turn) continue;
      if (e.do === 'say') return e.text[this.lang] ?? e.text.en ?? null;
      return EVENT_LINES[e.do][this.lang];
    }
    return null;
  }

  private event<K extends Event['do']>(kind: K): Extract<Event, { do: K }> | undefined {
    return this.scenario.events.find((e): e is Extract<Event, { do: K }> => e.do === kind);
  }

  private style(text: string): string {
    return this.persona.rambles ? `${RAMBLE[this.lang]}${text}` : text;
  }

  private answer(expecting: string): string {
    const lang = this.lang;
    const goal = this.scenario.goal;
    switch (expecting) {
      case 'intent':
        return this.opening(goal);
      case 'anything_else':
        return BYE[lang];
      case 'name':
        return this.style(this.sayName());
      case 'dob': {
        const wrong = this.event('wrong_dob');
        const dob = wrong?.dob ?? this.scenario.caller.dob;
        return dob ? sayDob(dob, this.persona.dobStyle, lang) : DONT_KNOW[lang];
      }
      case 'phone':
        return sayPhone(this.scenario.caller.phone ?? this.scenario.callerPhone ?? '9822299999');
      case 'service':
        return 'service' in goal ? (SERVICES[goal.service]?.[lang] ?? goal.service) : YES[lang];
      case 'when':
        return this.style(this.whenAnswer());
      case 'choice':
        return ORDINALS[('pickOption' in goal ? goal.pickOption : 1) - 1]?.[lang] ?? ORDINALS[0].en;
      case 'appointment':
        return ORDINALS[0][lang];
      case 'confirm': {
        const change = this.event('change_mind_at_confirm');
        if (change && !this.changedMind) {
          this.changedMind = true;
          const to = sayWhen(change.to, lang);
          return L(`No, make it ${to}.`, `Nahi, ${to} kar do.`, `नहीं, ${to} कर दो।`)[lang];
        }
        return YES[lang];
      }
      case 'message': {
        if (goal.intent !== 'message') return YES[lang];
        const said = goal.details ?? goal.text;
        return said[lang] ?? said.en ?? '';
      }
      case 'callback_confirm':
        return YES[lang];
      case 'identity_who':
        return this.identityAnswer(goal);
      case 'attendance':
        return this.attendanceAnswer(goal);
      default:
        return YES[lang];
    }
  }

  private sayName(): string {
    const { name, nameHi } = this.scenario.caller;
    const lang = this.lang;
    const spoken = lang === 'hi' && nameHi ? nameHi : name;
    if (this.persona.terse || this.namedOnce) return spoken;
    this.namedOnce = true;
    if (this.scenario.thirdParty) {
      return L(
        `The patient is ${spoken}.`,
        `Patient ka naam ${spoken} hai.`,
        `मरीज़ का नाम ${spoken} है।`,
      )[lang];
    }
    return L(`My name is ${spoken}.`, `Mera naam ${spoken} hai.`, `मेरा नाम ${spoken} है।`)[lang];
  }

  private whenAnswer(): string {
    const goal = this.scenario.goal;
    const when =
      'when' in goal ? goal.when : goal.intent === 'message' ? goal.alsoBook?.when : undefined;
    if (!when) return YES[this.lang];
    const said = sayWhen(when, this.lang);
    const inline = this.event('correct_day_inline');
    if (inline) {
      const wrong = sayDay(inline.wrongDay, this.lang);
      return L(`${wrong}... no, ${said}`, `${wrong}... nahi, ${said}`, `${wrong}... नहीं, ${said}`)[
        this.lang
      ];
    }
    return said;
  }

  private opening(goal: Goal): string {
    const lang = this.lang;
    const third = this.scenario.thirdParty;
    switch (goal.intent) {
      case 'book': {
        const service = SERVICES[goal.service]?.[lang] ?? goal.service;
        const doctor = goal.doctor ? ` ${DOCTORS[goal.doctor]?.[lang] ?? ''}` : '';
        const when = this.event('correct_day_inline') ? '' : ` ${sayWhen(goal.when, lang)}`;
        if (third) {
          return L(
            `I'd like to book a ${service}${doctor} for my mother${when}.`,
            `Meri mummy ke liye ${service}${doctor} ka appointment chahiye${when}.`,
            `मेरी मम्मी के लिए ${service}${doctor} का अपॉइंटमेंट चाहिए${when}।`,
          )[lang];
        }
        return L(
          `Hi, I'd like to book a ${service}${doctor}${when}.`,
          `Mujhe ${service}${doctor} ka appointment chahiye${when}.`,
          `मुझे ${service}${doctor} का अपॉइंटमेंट चाहिए${when}।`,
        )[lang];
      }
      case 'reschedule':
        return third
          ? L(
              "I need to change my father's appointment.",
              'Papa ka appointment change karna hai.',
              'पापा का अपॉइंटमेंट बदलना है।',
            )[lang]
          : L(
              'I need to reschedule my appointment.',
              'Mera appointment change karna hai.',
              'मुझे अपना अपॉइंटमेंट बदलना है।',
            )[lang];
      case 'cancel':
        return third
          ? L(
              "I want to cancel my father's appointment.",
              'Papa ka appointment cancel karna hai.',
              'पापा का अपॉइंटमेंट कैंसल करना है।',
            )[lang]
          : L(
              'I want to cancel my appointment.',
              'Mera appointment cancel karna hai.',
              'मेरा अपॉइंटमेंट कैंसल करना है।',
            )[lang];
      case 'message': {
        const text = goal.text[lang] ?? goal.text.en ?? '';
        if (!goal.alsoBook) return text;
        const service = SERVICES[goal.alsoBook.service]?.[lang] ?? goal.alsoBook.service;
        const when = sayWhen(goal.alsoBook.when, lang);
        return L(
          `I'd like to book a ${service} ${when}, and also, ${text}`,
          `Mujhe ${service} ka appointment chahiye ${when}, aur ek baat, ${text}`,
          `मुझे ${service} का अपॉइंटमेंट चाहिए ${when}, और एक बात, ${text}`,
        )[lang];
      }
      case 'faq':
        return {
          timings: L(
            'What are your timings?',
            'Clinic ki timing kya hai?',
            'क्लिनिक का समय क्या है?',
          ),
          address: L('Where is the clinic?', 'Clinic kahan hai?', 'क्लिनिक कहाँ है?'),
          fees: L(
            'How much is a consultation?',
            'Consultation ki fees kitni hai?',
            'परामर्श की फीस कितनी है?',
          ),
          insurance: L(
            'Do you take cashless insurance?',
            'Cashless insurance chalta hai kya?',
            'क्या कैशलेस इंश्योरेंस चलता है?',
          ),
        }[goal.topic][lang];
      case 'chitchat':
        return L('Hmm, the thing, you know?', 'Woh na, matlab, haan?', 'वो ना, मतलब, हाँ?')[lang];
      default:
        return YES[lang];
    }
  }

  private identityAnswer(goal: Goal): string {
    const lang = this.lang;
    switch (goal.intent) {
      case 'no_answer':
        return '[no answer]';
      case 'voicemail':
        return '[voicemail]';
      case 'family_answers':
        return L(
          "No, I'm her mother. She's not at home.",
          'Nahi, main unki mummy hoon. Woh ghar pe nahi hai.',
          'नहीं, मैं उनकी माँ हूँ। वो घर पर नहीं है।',
        )[lang];
      case 'wrong_number':
        return L(
          "Wrong number, there's no one by that name here.",
          'Galat number hai, is naam ka koi nahi hai.',
          'गलत नंबर है।',
        )[lang];
      case 'opt_out':
        return L(
          'Please don’t call me again.',
          'Mujhe dobara call mat karo.',
          'मुझे दोबारा कॉल मत करो।',
        )[lang];
      default:
        return L('Yes, speaking.', 'Haan, main hi bol rahi hoon.', 'हाँ, मैं ही बोल रही हूँ।')[
          lang
        ];
    }
  }

  private attendanceAnswer(goal: Goal): string {
    const lang = this.lang;
    switch (goal.intent) {
      case 'move_from_reminder': {
        const when = sayWhen(goal.when, lang);
        return L(
          `I can't make it. Can we move it to ${when}?`,
          `Nahi aa paungi, ${when} kar do.`,
          `नहीं आ पाऊँगी, ${when} कर दो।`,
        )[lang];
      }
      case 'cancel_from_reminder':
        return L('Please cancel it.', 'Cancel kar do.', 'कैंसल कर दो।')[lang];
      default:
        return L("Yes, I'll be there.", 'Haan, aa jaungi.', 'हाँ, आ जाऊँगी।')[lang];
    }
  }
}
