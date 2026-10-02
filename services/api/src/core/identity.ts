/**
 * Matching rules for patient verification.
 *
 * A name must match AND a second factor (date of birth or registered phone) must match
 * exactly. The name match is phonetic, because the same person arrives as "Pooja Malhotra"
 * (typed by staff), "Puja Malhotra" (another spelling) and "पूजा मल्होत्रा" (Hindi speech-to-text).
 * Names are reduced to consonant skeletons: lossy on purpose, safe because the second factor is
 * exact and the candidates are only the few patients sharing that phone or date of birth.
 */

const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'shri',
  'smt',
  'kumari',
  'sri',
  'shrimati',
]);
const SUFFIXES = new Set(['ji']);
const HONORIFICS_HI = new Set(['श्री', 'श्रीमती', 'कुमारी', 'डॉ', 'डॉक्टर', 'जी']);

// ---------------------------------------------------------------- Devanagari → Latin

const CONSONANTS: Record<string, string> = {
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  ङ: 'n',
  च: 'ch',
  छ: 'chh',
  ज: 'j',
  झ: 'jh',
  ञ: 'n',
  ट: 't',
  ठ: 'th',
  ड: 'd',
  ढ: 'dh',
  ण: 'n',
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  य: 'y',
  र: 'r',
  ल: 'l',
  ळ: 'l',
  व: 'v',
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
};
// Consonant + nukta (़).
const NUKTA: Record<string, string> = {
  क: 'q',
  ख: 'kh',
  ग: 'g',
  ज: 'z',
  ड: 'r',
  ढ: 'rh',
  फ: 'f',
  य: 'y',
};
const VOWELS: Record<string, string> = {
  अ: 'a',
  आ: 'aa',
  इ: 'i',
  ई: 'ee',
  उ: 'u',
  ऊ: 'oo',
  ऋ: 'ri',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
};
const MATRAS: Record<string, string> = {
  'ा': 'aa',
  'ि': 'i',
  'ी': 'ee',
  'ु': 'u',
  'ू': 'oo',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
};
const VIRAMA = '्';
const NUKTA_SIGN = '़';
const NASALS = new Set(['ं', 'ँ']);

/** Rough phonetic transliteration of one Devanagari word (with word-final schwa deletion). */
export function transliterate(word: string): string {
  // Code points are right here: every Devanagari letter and sign is a single BMP code point.
  const chars = Array.from(word.normalize('NFC'));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? '';
    const next = chars[i + 1];
    if (CONSONANTS[ch] !== undefined) {
      let base = CONSONANTS[ch];
      let j = i + 1;
      if (next === NUKTA_SIGN) {
        base = NUKTA[ch] ?? base;
        j++;
      }
      const after = chars[j];
      if (after === VIRAMA) {
        out += base;
        i = j;
      } else if (after !== undefined && MATRAS[after] !== undefined) {
        out += base + MATRAS[after];
        i = j;
      } else {
        // Inherent vowel, dropped at the end of a word (राहुल → rahul, not rahula).
        out += j >= chars.length ? base : `${base}a`;
        i = j - 1;
      }
    } else if (VOWELS[ch] !== undefined) {
      out += VOWELS[ch];
    } else if (NASALS.has(ch)) {
      out += 'n';
    } else if (ch === 'ः') {
      out += 'h';
    } else if (/[a-z]/i.test(ch)) {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/** Consonant skeleton: "Pooja" / "Puja" / "पूजा" → "pj"; "Verma" / "वर्मा" → "vrm". */
export function skeleton(latin: string): string {
  return latin
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/([kgcjtdpbs])h/g, '$1') // aspiration: kh→k, sh→s, th→t, chh→c…
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/[^a-z]/g, '');
}

function tokens(name: string): string[] {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t) && !SUFFIXES.has(t) && !HONORIFICS_HI.has(t));
}

/** Order-insensitive phonetic key for a full name. */
export function nameKey(name: string): string {
  return tokens(name)
    .map((t) => (/[ऀ-ॿ]/.test(t) ? transliterate(t) : t))
    .map(skeleton)
    .filter((t) => t.length > 0)
    .sort()
    .join(' ');
}

/** Last 10 digits of a phone number, or null if it can't be an Indian mobile. */
export function phoneKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}
