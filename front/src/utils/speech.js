// Helpers for turning assistant markdown into something worth reading aloud

// Voices offered in live mode, grouped by spoken language
export const SPEECH_LANGUAGES = [
  {
    code: "en",
    label: "English",
    voices: [
      { id: "bf_alice", label: "Alice (British)" },
      { id: "bm_george", label: "George (British)" },
      { id: "af_heart", label: "Heart (American)" },
      { id: "am_michael", label: "Michael (American)" },
    ],
  },
  {
    code: "de",
    label: "Deutsch",
    voices: [
      { id: "df_dora", label: "Dora" },
      { id: "dm_omega", label: "Omega" },
    ],
  },
];

export function getVoicesForLanguage(code) {
  return (
    SPEECH_LANGUAGES.find((language) => language.code === code)?.voices ||
    SPEECH_LANGUAGES[0].voices
  );
}

export function getDefaultVoice(code) {
  return getVoicesForLanguage(code)[0].id;
}

/**
 * Strip markdown and reasoning blocks so the synthesized speech does not read
 * out syntax, code or raw URLs.
 */
export function stripForSpeech(text) {
  if (typeof text !== "string") return "";
  return (
    text
      // Reasoning blocks are internal, never spoken
      .replace(/<think>[\s\S]*?<\/think>/g, " ")
      .replace(/<think>[\s\S]*$/g, " ")
      // Fenced code is unreadable out loud
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      // Images out, links reduced to their text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Bare URLs
      .replace(/https?:\/\/\S+/g, " ")
      // Headings, list bullets, quotes, table pipes
      .replace(/^\s{0,3}#{1,6}\s*/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\|/g, " ")
      // Emphasis markers
      .replace(/(\*\*|__|\*|_|~~)/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/**
 * Split text into chunks at sentence boundaries so playback can start before
 * the whole reply has been synthesized.
 */
export function splitIntoSpeechChunks(text, maxLength = 350) {
  const clean = text.trim();
  if (clean.length <= maxLength) return clean ? [clean] : [];

  const sentences = clean.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [clean];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (current && current.length + piece.length + 1 > maxLength) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
    // A single sentence longer than the limit is split on commas
    while (current.length > maxLength * 2) {
      const cut = current.lastIndexOf(",", maxLength);
      const index = cut > maxLength / 2 ? cut + 1 : maxLength;
      chunks.push(current.slice(0, index).trim());
      current = current.slice(index).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
