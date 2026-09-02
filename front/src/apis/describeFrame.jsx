import { createBackendClient } from "./openaiClient";

const DEFAULT_PROMPT =
  "Describe what is visible in this frame in one or two short, factual sentences. " +
  "Only report what you can actually see. Do not speculate, do not repeat the instructions, " +
  "and do not mention that this is a video frame or a screenshot.";

// Keep the rolling context small so the loop stays cheap and low latency
const CONTEXT_LIMIT = 5;

function buildContextText(previousDescriptions) {
  const recent = previousDescriptions.slice(-CONTEXT_LIMIT);
  if (recent.length === 0) return "";
  const lines = recent.map((description, index) => `${index + 1}. ${description}`);
  return (
    "These are the most recent descriptions of the preceding frames, " +
    "ordered from oldest to newest:\n" +
    lines.join("\n") +
    "\nDescribe the current frame. Mention explicitly what changed compared to the previous frames."
  );
}

// Reasoning models sometimes write their drafts into the content. Keep only the
// final description so the rolling observation stream stays readable.
const DRAFT_MARKER = /(^|\n)\s*(draft\s*\d|final polish|final answer|revised|let'?s |let me |okay|alright)/i;

function cleanDescription(raw) {
  if (typeof raw !== "string") return "";

  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();

  if (DRAFT_MARKER.test(text)) {
    // Prefer the last quoted candidate, that is where these models put the result
    const quoted = text.match(/"([^"]{20,})"/g);
    if (quoted?.length) {
      text = quoted[quoted.length - 1];
    } else {
      const paragraphs = text
        .split(/\n{2,}|\n/)
        .map((line) => line.trim())
        .filter((line) => line && !DRAFT_MARKER.test(line));
      if (paragraphs.length) text = paragraphs[paragraphs.length - 1];
    }
  }

  return text.replace(/^["'\s]+|["'\s]+$/g, "");
}

// Describe a single captured frame, using the previous descriptions as context
export async function describeFrame({
  dataUrl,
  model,
  previousDescriptions = [],
  prompt = DEFAULT_PROMPT,
  signal = null,
  timeout = 30000,
}) {
  const openai = createBackendClient(timeout);

  const userContent = [];
  const contextText = buildContextText(previousDescriptions);
  if (contextText) {
    userContent.push({ type: "text", text: contextText });
  }
  userContent.push({ type: "text", text: prompt });
  userContent.push({ type: "image_url", image_url: { url: dataUrl } });

  const response = await openai.chat.completions.create(
    {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a precise visual observer. Answer with one or two short factual " +
            "sentences and nothing else. Never show drafts, alternatives, reasoning or " +
            "preambles, and never wrap the answer in quotation marks.",
        },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      top_p: 0.5,
      stream: false,
    },
    signal ? { signal } : undefined
  );

  return cleanDescription(response?.choices?.[0]?.message?.content);
}

export { DEFAULT_PROMPT as DEFAULT_FRAME_PROMPT };
