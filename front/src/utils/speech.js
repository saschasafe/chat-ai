// Helpers for turning assistant markdown into something worth reading aloud

export const SPEECH_MODEL = "speaches-ai/Kokoro-82M-v1.0-ONNX";

/**
 * Languages offered in live mode. `voices` lists the Kokoro voices for that
 * language, ordered by the grades from the model card, so the first entry is
 * the best default. Kokoro ships no German voice and its Mandarin voices
 * return empty audio here, so those languages transcribe fine but fall back
 * to an English voice for playback.
 */
export const SPEECH_LANGUAGES = [
  {
    code: "en",
    label: "English",
    voices: [
      { id: "af_heart", label: "Heart (American, female)" },
      { id: "af_bella", label: "Bella (American, female)" },
      { id: "bf_emma", label: "Emma (British, female)" },
      { id: "af_nicole", label: "Nicole (American, female)" },
      { id: "am_michael", label: "Michael (American, male)" },
      { id: "bm_george", label: "George (British, male)" },
      { id: "bm_fable", label: "Fable (British, male)" },
      { id: "bm_lewis", label: "Lewis (British, male)" },
    ],
  },
  { code: "de", label: "Deutsch", voices: [] },
  {
    code: "es",
    label: "Español",
    voices: [
      { id: "ef_dora", label: "Dora (female)" },
      { id: "em_alex", label: "Alex (male)" },
      { id: "em_santa", label: "Santa (male)" },
    ],
  },
  {
    code: "fr",
    label: "Français",
    voices: [{ id: "ff_siwis", label: "Siwis (female)" }],
  },
  {
    code: "it",
    label: "Italiano",
    voices: [
      { id: "if_sara", label: "Sara (female)" },
      { id: "im_nicola", label: "Nicola (male)" },
    ],
  },
  {
    code: "pt",
    label: "Português",
    voices: [
      { id: "pf_dora", label: "Dora (female)" },
      { id: "pm_alex", label: "Alex (male)" },
      { id: "pm_santa", label: "Santa (male)" },
    ],
  },
  {
    code: "hi",
    label: "हिन्दी",
    voices: [
      { id: "hf_alpha", label: "Alpha (female)" },
      { id: "hf_beta", label: "Beta (female)" },
      { id: "hm_omega", label: "Omega (male)" },
      { id: "hm_psi", label: "Psi (male)" },
    ],
  },
  {
    code: "ja",
    label: "日本語",
    voices: [
      { id: "jf_alpha", label: "Alpha (female)" },
      { id: "jf_gongitsune", label: "Gongitsune (female)" },
      { id: "jm_kumo", label: "Kumo (male)" },
    ],
  },
];

const FALLBACK_VOICES = SPEECH_LANGUAGES[0].voices;

// True when Kokoro has no voice for this language and playback falls back
export function hasOwnVoices(code) {
  const language = SPEECH_LANGUAGES.find((entry) => entry.code === code);
  return (language?.voices?.length || 0) > 0;
}

export function getVoicesForLanguage(code) {
  const language = SPEECH_LANGUAGES.find((entry) => entry.code === code);
  return language?.voices?.length ? language.voices : FALLBACK_VOICES;
}

export function getDefaultVoice(code) {
  return getVoicesForLanguage(code)[0].id;
}

// Resolve the voice model, honouring the optional speech module config
export function getSpeechModel() {
  try {
    const speechModule = import.meta.env?.VITE_MODULE_SPEECH
      ? JSON.parse(import.meta.env.VITE_MODULE_SPEECH)
      : null;
    // The module config may carry a short alias, only accept a real model id
    if (speechModule?.model?.includes("/")) return speechModule.model;
  } catch {
    // Fall through to the default below
  }
  return SPEECH_MODEL;
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

// Kokoro sounds noticeably worse on very short utterances, so tiny trailing
// chunks are folded back into the preceding one.
const MIN_CHUNK_LENGTH = 60;

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

  // Fold undersized chunks into their predecessor
  const merged = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      chunk.length < MIN_CHUNK_LENGTH &&
      previous.length + chunk.length + 1 <= maxLength * 2
    ) {
      merged[merged.length - 1] = `${previous} ${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}
