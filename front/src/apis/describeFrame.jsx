import { createBackendClient } from "./openaiClient";

const DEFAULT_PROMPT =
  "Describe what is visible in this frame in one or two short, factual sentences. " +
  "Only report what you can actually see. Do not speculate, do not repeat the instructions, " +
  "and do not mention that this is a video frame or a screenshot. " +
  "Write plain prose only, with no coordinates, bounding boxes, JSON or markup.";

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

// Models with grounding abilities answer with coordinates on top of the prose,
// for example {"point": [483, 460], "label": "the man's hand"}. The log wants
// sentences, so those parts are dropped.
const GROUNDING_KEY = /["']?\b(?:point|label|box_2d|bbox|box)\b["']?\s*:/i;
const OPENERS = { "{": "}", "[": "]" };

/**
 * Remove bracketed spans that carry coordinate keys.
 *
 * Nesting is tracked, otherwise the array inside {"point": [1, 2]} would end
 * the span early and leave the tail behind. Unbalanced spans are kept here and
 * mopped up afterwards, since a half written object has no reliable end.
 */
function stripGroundingSpans(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (!OPENERS[char]) {
      result += char;
      index += 1;
      continue;
    }
    let depth = 0;
    let end = index;
    for (; end < text.length; end += 1) {
      if (OPENERS[text[end]]) depth += 1;
      else if (text[end] === "}" || text[end] === "]") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (end >= text.length) {
      result += char;
      index += 1;
      continue;
    }
    const span = text.slice(index, end + 1);
    result += GROUNDING_KEY.test(span) ? " " : span;
    index = end + 1;
  }
  return result;
}

// An observation describes, it never instructs. These openings mean the model
// echoed the task back instead of answering it.
const INSTRUCTION_ECHO =
  /^(describe|mention|note|report|identify|list|explain|focus|tell|answer|provide|output|summari[sz]e)\b/i;

function dropInstructionEchoes(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !INSTRUCTION_ECHO.test(sentence))
    .join(" ");
}

function cleanDescription(raw) {
  if (typeof raw !== "string") return "";

  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();

  // Fenced blocks are where these models like to put their JSON
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = stripGroundingSpans(text);
  // Remnants of an unbalanced object, such as "point": [ L 480, 250
  text = text.replace(
    /["']?\b(?:point|label|box_2d|bbox)\b["']?\s*:\s*(?:\[[^\]]*\]?|"[^"]*"|[-\d.,\s]+)/gi,
    " "
  );
  text = text
    .replace(/[{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Leading debris left by a stripped span, like ". Describe..." or "H A man"
    .replace(/^[.,;:!?]+\s*/, "")
    .replace(/^(?![AI]\s)[A-Za-z]\s+(?=[A-Z])/, "")
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

  text = dropInstructionEchoes(text.replace(/^["'\s]+|["'\s]+$/g, ""));
  // An entry that held nothing but coordinates is now empty, and the caller
  // skips empty results rather than logging a blank line.
  return text.trim();
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
            "preambles, and never wrap the answer in quotation marks. Never point at " +
            "anything: no coordinates, bounding boxes, JSON or markup, and never repeat " +
            "the question back.",
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
