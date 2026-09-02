import { useCallback, useEffect, useRef, useState } from "react";
import { convertToWav } from "../utils/attachments";

const SPEECH_THRESHOLD = 0.045; // Normalised level above which we assume speech
const NOISE_FLOOR = 0.02; // Below this we treat the input as silence

/**
 * Microphone recorder with voice activity detection.
 *
 * Recording stops automatically once the speaker has been quiet for
 * `silenceMs` after speaking, which is what drives the hands free loop.
 */
export function useVoiceRecorder({
  onComplete,
  onError,
  silenceMs = 1200,
  maxDurationMs = 60000,
  minDurationMs = 400,
} = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [hasSpeech, setHasSpeech] = useState(false);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const frameRef = useRef(null);
  const chunksRef = useRef([]);

  const isRecordingRef = useRef(false);
  const hasSpeechRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const mimeTypeRef = useRef("audio/webm");

  // Keep the latest callbacks without restarting the analyser loop
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

  const teardown = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    dataArrayRef.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // onstop does the rest
    } else {
      teardown();
    }
  }, [teardown]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (isRecordingRef.current) return;

    const isSecureContext =
      window.isSecureContext ||
      location.protocol === "https:" ||
      location.hostname === "localhost";
    if (!isSecureContext) {
      onErrorRef.current?.(
        new Error("Microphone access requires HTTPS or localhost.")
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      cancelledRef.current = false;
      chunksRef.current = [];
      hasSpeechRef.current = false;
      setHasSpeech(false);

      // Level metering + voice activity detection
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

      let mimeType = "audio/webm";
      for (const candidate of [
        "audio/wav",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ]) {
        if (MediaRecorder.isTypeSupported(candidate)) {
          mimeType = candidate;
          break;
        }
      }
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const wasCancelled = cancelledRef.current;
        const spoke = hasSpeechRef.current;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        teardown();

        if (wasCancelled || !spoke || chunks.length === 0) return;

        try {
          const blob = new Blob(chunks, { type: mimeTypeRef.current });
          const wavBlob = mimeTypeRef.current.includes("wav")
            ? blob
            : await convertToWav(blob);
          onCompleteRef.current?.(wavBlob);
        } catch (error) {
          onErrorRef.current?.(error);
        }
      };

      startedAtRef.current = Date.now();
      lastSpeechAtRef.current = Date.now();
      recorder.start(100);
      isRecordingRef.current = true;
      setIsRecording(true);

      const tick = () => {
        if (!isRecordingRef.current || !analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        const sum = dataArrayRef.current.reduce((acc, value) => acc + value, 0);
        const normalized = sum / dataArrayRef.current.length / 255;
        setLevel(normalized);

        const now = Date.now();
        if (normalized > SPEECH_THRESHOLD) {
          lastSpeechAtRef.current = now;
          if (!hasSpeechRef.current) {
            hasSpeechRef.current = true;
            setHasSpeech(true);
          }
        }

        const elapsed = now - startedAtRef.current;
        const quietFor = now - lastSpeechAtRef.current;
        const longEnough = elapsed > minDurationMs;

        // End the turn once the speaker went quiet, or when the cap is reached
        if (
          (hasSpeechRef.current &&
            longEnough &&
            normalized < NOISE_FLOOR &&
            quietFor > silenceMs) ||
          elapsed > maxDurationMs
        ) {
          stop();
          return;
        }

        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (error) {
      teardown();
      isRecordingRef.current = false;
      setIsRecording(false);
      onErrorRef.current?.(error);
    }
  }, [maxDurationMs, minDurationMs, silenceMs, stop, teardown]);

  // Release the microphone if the component goes away mid recording
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      isRecordingRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      teardown();
    };
  }, [teardown]);

  return { isRecording, level, hasSpeech, start, stop, cancel };
}
