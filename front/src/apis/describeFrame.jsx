import OpenAI from "openai";

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

function resolveBaseURL() {
  let baseURL = import.meta.env.VITE_BACKEND_ENDPOINT;
  try {
    return new URL(baseURL).toString();
  } catch {
    return new URL(baseURL, window.location.origin).toString();
  }
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
  const openai = new OpenAI({
    baseURL: resolveBaseURL(),
    apiKey: null,
    dangerouslyAllowBrowser: true,
    timeout,
  });

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
            "You are a precise visual observer. You answer with a short factual description and nothing else.",
        },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      top_p: 0.5,
      stream: false,
    },
    signal ? { signal } : undefined
  );

  const text = response?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

export { DEFAULT_PROMPT as DEFAULT_FRAME_PROMPT };
