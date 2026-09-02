// Speech to text through the Chat AI backend proxy
export async function transcribeAudio({
  audioBlob,
  model = "whisper-large-v2",
  language = null,
  signal = null,
}) {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.wav");
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
    } catch {}
    throw new Error(`Transcription failed: ${message}`);
  }

  const data = await response.json();
  return (data?.text || "").trim();
}
