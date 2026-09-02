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

// Speech to text through the Chat AI backend proxy
export async function transcribeAudio({
  audioBlob,
  model = "whisper-large-v2",
  language = null,
  signal = null,
}) {
  const attempt = async () => {
    // Rebuilt per attempt, a consumed FormData body cannot be reused
    const formData = new FormData();
    formData.append("file", audioBlob, filenameFor(audioBlob));
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

  return withAudioRetry(attempt, signal);
}
