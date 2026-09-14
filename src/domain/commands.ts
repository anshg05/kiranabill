/**
 * Voice commands ("bas", "ho gaya", "hatao"...) are whole-utterance
 * instructions - finalise the bill, undo the last line, clear everything -
 * never catalog items. docs/14-LEGACY-REFERENCE.md KI-02: the predecessor
 * matched these with `text.includes("bas")`, which also matched "basmati"
 * and silently finalised the bill. See commands.test.ts for the full
 * 482-alias sweep that guards against this happening again.
 *
 * Match rule (docs/10-TRACKER.md KB-002, agreed with the owner):
 *   (a) the command phrase must appear as a whole token, or an exact
 *       contiguous token sequence for multi-word commands, in the
 *       filler-stripped utterance - never a substring of a longer token
 *       ("bas" must not match inside "basmati").
 *   (b) the utterance contains no digit (ASCII or Devanagari) anywhere -
 *       a real quantity or price means this is an item line, not a command.
 *   (c) at most 6 tokens remain after filler-stripping.
 * When more than one phrase matches (e.g. "sab hatao" contains the token
 * "hatao", which alone means removeLast), the longest matching phrase wins.
 */

export type BillCommand = "finalize" | "removeLast" | "clearAll";

/** Same filler list as the Layer-2 Gemini prompt (docs/14-LEGACY-REFERENCE.md
 * section 1: "Ignore fillers: aur, bhi, ruk, haan, ok, bhai, please"), so
 * both layers treat the same words as noise. */
const FILLERS = new Set(["aur", "bhi", "ruk", "haan", "ok", "bhai", "please"]);

const MAX_TOKENS_AFTER_FILLER_STRIP = 6;

/**
 * Latin phrases ported verbatim from `legacy/voice.js` (`isVoiceCommandText`
 * and the finalize/remove/clear dispatch in `handleFinalTranscript`) - that
 * file, not `14-LEGACY-REFERENCE.md`, is the source of the command
 * vocabulary; the reference doc only recorded the KI-02 defect, not the
 * word list itself.
 *
 * Devanagari phrases are this session's addition, not from legacy - the
 * old app only ever matched Latin script. Added because transcripts can
 * arrive in either script (same reasoning as HINDI_NUMBERS/HINDI_FRACTIONS,
 * docs/14-LEGACY-REFERENCE.md section 3), and because "बस" firing is a
 * proof requirement in docs/18-AGENT-CONTRACT.md section 8. Kept to
 * high-confidence colloquial equivalents only; loanwords commonly spoken
 * in English even mid-Hindi-sentence ("total", "done", "complete", "finish",
 * "remove", "delete", "undo") are left Latin-only rather than guessed at.
 * Flag any of these that read wrong.
 */
const COMMAND_PHRASES: Record<BillCommand, readonly string[]> = {
  finalize: [
    "ho gaya", "hogaya", "bill bana", "bill banao", "total", "bas", "done",
    "complete", "khatam", "finish",
    "बस", "हो गया", "होगया", "बिल बनाओ", "खतम",
  ],
  removeLast: [
    "hatao", "hata do", "last hatao", "pichla hatao", "remove", "undo",
    "wapas", "delete",
    "हटाओ", "हटा दो", "वापस", "पिछला हटाओ",
  ],
  clearAll: [
    "sab hatao", "clear karo", "sab delete",
    "सब हटाओ", "साफ करो",
  ],
};

interface PhraseEntry {
  readonly type: BillCommand;
  readonly tokens: readonly string[];
}

const COMMAND_ENTRIES: readonly PhraseEntry[] = (
  Object.entries(COMMAND_PHRASES) as [BillCommand, readonly string[]][]
).flatMap(([type, phrases]) => phrases.map((phrase) => ({ type, tokens: phrase.split(" ") })));

const DIGIT_PATTERN = /[0-9०-९]/;

function normalizeToTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !FILLERS.has(token));
}

function containsSequence(tokens: readonly string[], phrase: readonly string[]): boolean {
  for (let start = 0; start <= tokens.length - phrase.length; start++) {
    if (phrase.every((word, offset) => tokens[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

/**
 * Matches a transcript against the voice command vocabulary. Returns null
 * for anything that isn't unambiguously a whole-utterance command - most
 * importantly, every catalog item and every bare product mention.
 */
export function matchCommand(text: string): BillCommand | null {
  const tokens = normalizeToTokens(text);
  if (tokens.length === 0 || tokens.length > MAX_TOKENS_AFTER_FILLER_STRIP) {
    return null;
  }
  if (tokens.some((token) => DIGIT_PATTERN.test(token))) {
    return null;
  }

  let best: PhraseEntry | null = null;
  for (const entry of COMMAND_ENTRIES) {
    if (containsSequence(tokens, entry.tokens) && (!best || entry.tokens.length > best.tokens.length)) {
      best = entry;
    }
  }
  return best ? best.type : null;
}
