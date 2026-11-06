const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670]/g;
const ARABIC_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;

const ARABIC_VARIANTS = Object.freeze({
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ؤ: "و",
  ئ: "ي",
  ى: "ي",
});
const ARABIC_WORD_PATTERN = /^[\u0621-\u064a]+$/u;

function normalizeArabicDigit(character) {
  const codePoint = character.codePointAt(0);

  if (codePoint >= 0x0660 && codePoint <= 0x0669) {
    return String(codePoint - 0x0660);
  }

  if (codePoint >= 0x06f0 && codePoint <= 0x06f9) {
    return String(codePoint - 0x06f0);
  }

  return character;
}

/**
 * Normalizes transcript and extracted quote text before comparing them.
 * This deliberately preserves word boundaries while making Arabic fixture text
 * tolerant of diacritics, tatweel, punctuation, digit styles, and whitespace.
 */
export function normalizeTranscriptText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/ـ/g, " ")
    .replace(ARABIC_DIGITS, normalizeArabicDigit)
    .replace(/[أإآٱؤئى]/g, (character) => ARABIC_VARIANTS[character] ?? character)
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchesTranscriptToken(transcriptToken, evidenceToken) {
  if (transcriptToken === evidenceToken) {
    return true;
  }

  if (!ARABIC_WORD_PATTERN.test(transcriptToken) || !ARABIC_WORD_PATTERN.test(evidenceToken)) {
    return false;
  }

  const prefix = transcriptToken.slice(0, transcriptToken.length - evidenceToken.length);
  return transcriptToken.endsWith(evidenceToken) && /^(?:ال|ب|و|ف|ك|ل)+$/u.test(prefix);
}

function containsTokenSequence(tokens, sequence) {
  if (sequence.length === 0 || sequence.length > tokens.length) {
    return false;
  }

  for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
    if (sequence.every((token, offset) => matchesTranscriptToken(tokens[start + offset], token))) {
      return true;
    }
  }

  return false;
}

function tokenizeTranscriptText(value) {
  return normalizeTranscriptText(value).split(" ").filter(Boolean);
}

export function transcriptContainsEvidence(transcriptText, evidenceQuote) {
  return containsTokenSequence(
    tokenizeTranscriptText(transcriptText),
    tokenizeTranscriptText(evidenceQuote),
  );
}

/**
 * Returns the one transcript turn that can verify an evidence field, or null
 * when the field is missing, points at the wrong speaker, or quotes different text.
 */
export function getTranscriptTurnForEvidence(field, transcript = []) {
  if (
    !Array.isArray(transcript)
    || field?.status !== "found"
    || typeof field.evidenceQuote !== "string"
    || !Number.isInteger(field.evidenceTurn)
  ) {
    return null;
  }

  const turn = transcript.find((candidate) => candidate.i === field.evidenceTurn);

  return turn?.speaker === "shop" && transcriptContainsEvidence(turn.text, field.evidenceQuote)
    ? turn
    : null;
}

export function isEvidenceFieldTraceable(field, transcript = []) {
  return getTranscriptTurnForEvidence(field, transcript) !== null;
}

export function getQuoteTranscript(quote, transcript = []) {
  if (Array.isArray(transcript) && transcript.length > 0) {
    return transcript;
  }

  return Array.isArray(quote?.transcript) ? quote.transcript : [];
}
