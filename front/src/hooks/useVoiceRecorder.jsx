import { useCallback, useEffect, useRef, useState } from "react";
import { convertToWav } from "../utils/attachments";

// Levels are time domain RMS, so roughly 0.05 to 0.25 for normal speech and
// well under 0.01 for a quiet room.
const SPEECH_THRESHOLD = 0.03; // Above this we assume speech
const NOISE_FLOOR = 0.012; // Below this we treat the input as silence
const LEVEL_DECAY = 0.82; // Smooths the meter so the orb does not flicker

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
  const forcedRef = useRef(false);
  const smoothedLevelRef = useRef(0);
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
    smoothedLevelRef.current = 0;
    setLevel(0);
  }, []);

  /**
   * Stop recording. `force` submits the take even when the detector never
   * registered speech, which is what the manual "send now" control needs.
   */
  const stop = useCallback(({ force = false } = {}) => {
    if (!isRecordingRef.current) return;
    if (force) forcedRef.current = true;
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
      forcedRef.current = false;
      chunksRef.current = [];
      hasSpeechRef.current = false;
      smoothedLevelRef.current = 0;
      setHasSpeech(false);

      // Level metering + voice activity detection
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.fftSize);

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
        const spoke = hasSpeechRef.current || forcedRef.current;
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

        // Time domain RMS. Averaging the frequency bins instead would dilute
        // speech energy across the mostly empty high bins and barely move.
        const samples = dataArrayRef.current;
        analyserRef.current.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i++) {
          const deviation = (samples[i] - 128) / 128;
          sumSquares += deviation * deviation;
        }
        const normalized = Math.sqrt(sumSquares / samples.length);

        // Fast attack, slow release, so the orb follows speech smoothly
        smoothedLevelRef.current = Math.max(
          normalized,
          smoothedLevelRef.current * LEVEL_DECAY
        );
        setLevel(smoothedLevelRef.current);

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
