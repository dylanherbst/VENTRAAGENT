// Browser voice helpers for the Receptionist Lab Live AI Test (task A-41). Client-safe: no server imports, types only.
// Speech-to-text is the Web Speech API (SpeechRecognition, or webkitSpeechRecognition in Chrome/Safari) in en-AU; replies
// are read out with speechSynthesis in en-AU. Either may be missing: the page then works by keyboard alone.
import type { LiveAiState } from '../setter-lab/live-auth';

export const LANG = 'en-AU';

type Alternative = { transcript: string };
type Result = { readonly isFinal: boolean; readonly length: number; [i: number]: Alternative };
export type RecognitionEvent = { resultIndex: number; results: { readonly length: number; [i: number]: Result } };
export type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionCtor = new () => Recognition;
type VoiceLike = { lang: string; name: string };
type SpeechWindow = { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor; speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };

const win = (w?: unknown): SpeechWindow | null => (w ?? (typeof window === 'undefined' ? null : window)) as SpeechWindow | null;

/** The speech recogniser constructor, or null when this browser has none (keyboard only). */
export function recognitionCtor(w?: unknown): RecognitionCtor | null {
  const x = win(w);
  return x?.SpeechRecognition ?? x?.webkitSpeechRecognition ?? null;
}

/** What this browser can do. Both false on the server. */
export function speechSupport(w?: unknown): { listen: boolean; speak: boolean } {
  const x = win(w);
  return { listen: !!recognitionCtor(x), speak: !!x && !!x.speechSynthesis && typeof x.SpeechSynthesisUtterance === 'function' };
}

/** A recogniser set up for one spoken line in Australian English. */
export function newRecognition(ctor: RecognitionCtor): Recognition {
  const r = new ctor();
  r.lang = LANG; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  return r;
}

/** Final and interim text from a recognition event. */
export function transcriptOf(e: RecognitionEvent): { final: string; interim: string } {
  let final = '', interim = '';
  for (let i = 0; i < e.results.length; i++) {
    const r = e.results[i], t = r?.[0]?.transcript ?? '';
    if (r?.isFinal) final += t; else interim += t;
  }
  return { final: final.replace(/\s+/g, ' ').trim(), interim: interim.replace(/\s+/g, ' ').trim() };
}

/** An en-AU voice if the browser has one (exact tag first, then any en-AU spelling), else null (browser default + lang). */
export function pickVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  return voices.find(v => v.lang === LANG) ?? voices.find(v => norm(v.lang) === 'en-au') ?? null;
}

/** LIVE only when the server reports a configured model and no live call has since said otherwise. */
export const liveBadge = (modelConfigured: boolean, liveAi: LiveAiState): 'LIVE' | 'DEMO' => (modelConfigured && liveAi !== 'not_configured' ? 'LIVE' : 'DEMO');
