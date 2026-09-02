import { convertToWav } from "../utils/attachments";
import { isRetryableStatus, withAudioRetry } from "./audioRetry";

// Keep the extension in step with the blob, some backends key off it
const EXTENSIONS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

function filenameFor(blob) {
  const mimeType = (blob?.type || "").split(";")[0].trim().toLowerCase();
  return `audio.${EXTENSIONS[mimeType] || "webm"}`;
}

function isWav(blob) {
  return (blob?.type || "").toLowerCase().includes("wav");
}

// Speech to text through the Chat AI backend proxy
export async function transcribeAudio({
  audioBlob,
  model = "whisper-large-v2",
  language = null,
  signal = null,
}) {
  const post = (blob, retry = true) => {
    const attempt = async () => {
      // Rebuilt per attempt, a consumed FormData body cannot be reused
      const formData = new FormData();
      formData.append("file", blob, filenameFor(blob));
      formData.append("model", model);
      if (language) formData.append("language", language);

      const response = await fetch(
        import.meta.env.VITE_BACKEND_ENDPOINT + "/audio/transcriptions",
        {
          method: "POST",
          body: formData,
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
        const error = new Error(`Transcription failed: ${message}`);
        error.retryable = isRetryableStatus(response.status);
        throw error;
      }

      const data = await response.json();
      return (data?.text || "").trim();
    };

    return retry ? withAudioRetry(attempt, signal) : attempt();
  };

  // The recorder's native container is the fast path, but the transcription
  // service does not accept every one of them and answers 500 with an empty
  // body when it cannot read the file. Since re-sending an unreadable file
  // cannot help, one attempt is enough before falling back to plain PCM WAV,
  // which costs a decode pass and is the one format it always takes. The
  // fallback keeps the retries, so a merely flaky upstream still recovers.
  const canFallBack = !isWav(audioBlob);
  try {
    return await post(audioBlob, !canFallBack);
  } catch (error) {
    if (!canFallBack || error?.name === "AbortError" || !error?.retryable) {
      throw error;
    }
    console.warn("Transcription failed, retrying as WAV:", error.message);
    let wav;
    try {
      wav = await convertToWav(audioBlob);
    } catch {
      throw error; // The original failure is the useful one to report
    }
    return post(wav);
  }
}
