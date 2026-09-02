// Text to speech through the Chat AI backend proxy
export async function synthesizeSpeech({
  text,
  voice = "bf_alice",
  model = "speaches-ai/Kokoro-82M-v1.0-ONNX",
  speed = null,
  signal = null,
}) {
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
    } catch {}
    throw new Error(`Speech synthesis failed: ${message}`);
  }

  return await response.blob();
}
