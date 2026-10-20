import type { Language } from './schema.js';

/**
 * Audio mode: the simulated patient's words go text → Sarvam Bulbul (speech) → Sarvam Saaras
 * (transcript) before Myna sees them, so the run measures what real speech recognition does to
 * Hinglish names, dates and numbers, not only what the logic does with clean text.
 *
 * The browser voice path streams audio over a WebSocket; this uses the same Saaras model through
 * its REST endpoint, one utterance at a time. Same recogniser, simpler plumbing; streaming latency
 * is measured separately by the voice pipeline itself.
 */

export interface Heard {
  /** What the recogniser returned. */
  heard: string;
  /** Detected language code, e.g. "hi-IN". */
  detected: string | null;
  ttsMs: number;
  asrMs: number;
  /** Characters sent to TTS and seconds of audio sent to STT (for cost). */
  ttsChars: number;
  audioSeconds: number;
}

export interface AudioChannel {
  roundTrip(text: string, lang: Language, seed: string): Promise<Heard>;
}

const BASE = 'https://api.sarvam.ai';
const TTS_LANG: Record<Language, string> = { en: 'en-IN', hinglish: 'hi-IN', hi: 'hi-IN' };
/** Bulbul v3 speakers: a mix of voices so recognition isn't tuned to one. */
const VOICES = ['priya', 'rahul', 'neha', 'aditya', 'pooja', 'rohan'];
const SAMPLE_RATE = 16_000;
/** Starter plan: ~40-60 requests a minute across text and speech. */
const MIN_GAP_MS = 1200;

export interface SarvamAudioOptions {
  apiKey: string;
  ttsModel?: string;
  sttModel?: string;
  /** Saaras mode ("transcribe", "codemix"…). Only honoured by saaras:v3. */
  sttMode?: string;
}

export class SarvamAudio implements AudioChannel {
  private readonly opts: Required<SarvamAudioOptions>;
  retries = 0;

  constructor(opts: SarvamAudioOptions) {
    this.opts = { ttsModel: 'bulbul:v3', sttModel: 'saaras:v4', sttMode: 'transcribe', ...opts };
  }

  async roundTrip(text: string, lang: Language, seed: string): Promise<Heard> {
    const voice =
      VOICES[Array.from(seed).reduce((n, ch) => n + (ch.codePointAt(0) ?? 0), 0) % VOICES.length];
    const speech = await this.call<{ audios: string[] }>('/text-to-speech', {
      json: {
        text,
        language_code: TTS_LANG[lang],
        model: this.opts.ttsModel,
        speaker: voice,
        speech_sample_rate: SAMPLE_RATE,
        output_audio_codec: 'wav',
      },
    });
    const ttsMs = speech.ms;
    const wav = Buffer.from(speech.audios[0] ?? '', 'base64');
    if (wav.length === 0) throw new Error('Sarvam TTS returned no audio');

    const form = new FormData();
    form.set('file', new Blob([wav], { type: 'audio/wav' }), 'caller.wav');
    form.set('model', this.opts.sttModel);
    form.set('language_code', 'unknown');
    if (this.opts.sttModel === 'saaras:v3') form.set('mode', this.opts.sttMode);
    const out = await this.call<{ transcript?: string; language_code?: string | null }>(
      '/speech-to-text',
      { form },
    );
    const asrMs = out.ms;

    return {
      heard: (out.transcript ?? '').trim(),
      detected: out.language_code ?? null,
      ttsMs: Math.round(ttsMs),
      asrMs: Math.round(asrMs),
      ttsChars: text.length,
      // 16-bit mono PCM at SAMPLE_RATE, minus the 44-byte WAV header.
      audioSeconds: Math.max(0, (wav.length - 44) / (SAMPLE_RATE * 2)),
    };
  }

  private lastCall = 0;

  /** Spaces calls out so a run stays under the plan's per-minute limit instead of retrying. */
  private async pace(): Promise<void> {
    const wait = this.lastCall + MIN_GAP_MS - Date.now();
    this.lastCall = Math.max(Date.now(), this.lastCall + MIN_GAP_MS);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  /** POST with 429/5xx retry and backoff: the Starter plan rate-limits chat and speech alike. */
  /** Returns the response plus how long the SUCCESSFUL request took (not the pacing or retries). */
  private async call<T>(
    path: string,
    body: { json: unknown } | { form: FormData },
  ): Promise<T & { ms: number }> {
    for (let attempt = 0; ; attempt++) {
      await this.pace();
      const started = performance.now();
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.opts.apiKey,
          ...('json' in body ? { 'content-type': 'application/json' } : {}),
        },
        body: 'json' in body ? JSON.stringify(body.json) : body.form,
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) {
        const json = (await res.json()) as T;
        return { ...json, ms: performance.now() - started };
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 8) {
        throw new Error(`Sarvam ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      this.retries++;
      const after = Number(res.headers.get('retry-after')) * 1000;
      await new Promise((r) =>
        setTimeout(
          r,
          Number.isFinite(after) && after > 0 ? after : Math.min(15_000, 1000 * 2 ** attempt),
        ),
      );
    }
  }
}

/** For tests: returns the words unchanged, as if recognition were perfect. */
export class LoopbackAudio implements AudioChannel {
  roundTrip(text: string): Promise<Heard> {
    return Promise.resolve({
      heard: text,
      detected: null,
      ttsMs: 0,
      asrMs: 0,
      ttsChars: text.length,
      audioSeconds: text.length / 15,
    });
  }
}

/** Character error rate between what was said and what was heard (0 = identical). */
export function cer(said: string, heard: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const a = Array.from(norm(said));
  const b = Array.from(norm(heard));
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0;
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return (prev[b.length] ?? 0) / a.length;
}

/**
 * Same person, spelled a little differently ("Kamla" / "Kamala")? Every word within 20% of its
 * counterpart. Tight on purpose: "Neha" / "Deha" is one letter in four (25%), a different name.
 */
export function sameName(a: string, b: string): boolean {
  const x = a.toLowerCase().split(/\s+/).filter(Boolean);
  const y = b.toLowerCase().split(/\s+/).filter(Boolean);
  // Devanagari names get written with or without the space ("मोहन लाल" / "मोहनलाल").
  if (x.join('') === y.join('')) return true;
  return x.length === y.length && x.every((word, i) => cer(word, y[i] ?? '') <= 0.2);
}
