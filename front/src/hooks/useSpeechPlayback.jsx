import { useCallback, useEffect, useRef, useState } from "react";
import { synthesizeSpeech } from "../apis/audioSpeech";
import { splitIntoSpeechChunks, stripForSpeech } from "../utils/speech";

/**
 * Speaks assistant replies through the backend TTS proxy.
 *
 * Long replies are split into sentence sized chunks so playback can start
 * early; the next chunk is fetched while the current one is playing.
 */
export function useSpeechPlayback({ onError, onFinished } = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  const audioRef = useRef(null);
  const abortRef = useRef(null);
  const urlsRef = useRef([]);
  const runIdRef = useRef(0);

  const onErrorRef = useRef(onError);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onErrorRef.current = onError;
    onFinishedRef.current = onFinished;
  }, [onError, onFinished]);

  const releaseUrls = useCallback(() => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
  }, []);

  const stop = useCallback(() => {
    runIdRef.current += 1; // Invalidate any in-flight run
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    releaseUrls();
    setIsSpeaking(false);
  }, [releaseUrls]);

  const playBlob = useCallback((blob, runId) => {
    return new Promise((resolve, reject) => {
      if (runId !== runIdRef.current) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      urlsRef.current.push(url);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Audio playback failed"));
      audio.play().catch(reject);
    });
  }, []);

  const speak = useCallback(
    async ({ text, voice, model }) => {
      const clean = stripForSpeech(text);
      const chunks = splitIntoSpeechChunks(clean);
      if (chunks.length === 0) {
        onFinishedRef.current?.();
        return;
      }

      stop();
      const runId = runIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsSpeaking(true);

      const request = (chunk) =>
        synthesizeSpeech({
          text: chunk,
          voice,
          ...(model ? { model } : {}),
          signal: controller.signal,
        });

      try {
        let pending = request(chunks[0]);
        for (let index = 0; index < chunks.length; index++) {
          const blob = await pending;
          if (runId !== runIdRef.current) return;
          // Fetch the next chunk while the current one plays
          pending =
            index + 1 < chunks.length ? request(chunks[index + 1]) : null;
          await playBlob(blob, runId);
          if (runId !== runIdRef.current) return;
        }
        if (runId !== runIdRef.current) return;
        setIsSpeaking(false);
        releaseUrls();
        onFinishedRef.current?.();
      } catch (error) {
        if (runId !== runIdRef.current || error?.name === "AbortError") return;
        setIsSpeaking(false);
        releaseUrls();
        onErrorRef.current?.(error);
        onFinishedRef.current?.();
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [playBlob, releaseUrls, stop]
  );

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { isSpeaking, speak, stop };
}
