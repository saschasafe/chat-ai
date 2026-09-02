import { getDefaultVoice, getSpeechModel } from "../utils/speech";
import { isRetryableStatus, withAudioRetry } from "./audioRetry";

// Text to speech through the Chat AI backend proxy
export async function synthesizeSpeech({
  text,
  voice = getDefaultVoice("en"),
  model = getSpeechModel(),
  speed = null,
  signal = null,
}) {
  const attempt = async () => {
    const response = await fetch(
      import.meta.env.VITE_BACKEND_ENDPOINT + "/audio/speech",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: text,
          voice,
          model,
          response_format: "mp3",
          ...(speed ? { speed } : {}),
        }),
        signal,
      }
    );

    if (!response.ok) {
      let message = response.statusText;
      try {
        const data = await response.json();
        message = data?.error || message;
      } catch {
        // Keep the status text
      }
      const error = new Error(`Speech synthesis failed: ${message}`);
      error.retryable = isRetryableStatus(response.status);
      throw error;
    }

    const blob = await response.blob();
    // A 200 with an empty body means the voice produced nothing usable
    if (blob.size === 0) {
      const error = new Error(`Speech synthesis returned no audio for ${voice}`);
      error.retryable = true;
      throw error;
    }
    return blob;
  };

  return withAudioRetry(attempt, signal);
}
