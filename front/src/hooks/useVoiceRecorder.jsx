import { useCallback, useEffect, useRef, useState } from "react";

// Levels are time domain RMS, so roughly 0.05 to 0.25 for normal speech and
// well under 0.01 for a quiet room.
const SPEECH_THRESHOLD = 0.03; // Above this we assume speech
const NOISE_FLOOR = 0.012; // Below this we treat the input as silence
const LEVEL_DECAY = 0.82; // Smooths the meter so the orb does not flicker

// Give up on a take that never contained any speech, so a microphone that
// stays silent cannot hold the turn open until the hard cap.
const NO_SPEECH_TIMEOUT_MS = 10000;

/**
 * Level below which the input counts as silence.
 *
 * A headset with gain control can idle well above a fixed noise floor, so the
 * quietest moment of the current take sets the bar. It is capped below the
 * speech threshold so a loud room can never raise it far enough to cut speech
 * off mid sentence.
 */
export function silenceLevelFor(quietest) {
  return Math.min(
    Math.max(NOISE_FLOOR, quietest * 2),
    SPEECH_THRESHOLD * 0.8
  );
}

/** Whether the current take should end. Pure, so the timing is testable. */
export function shouldEndTake({
  hasSpeech,
  level,
  silenceLevel,
  elapsed,
  quietFor,
  silenceMs,
  minDurationMs,
  maxDurationMs,
}) {
  if (elapsed > maxDurationMs) return "cap";
  // Nothing was ever said, so do not hold the turn open
  if (!hasSpeech) return elapsed > NO_SPEECH_TIMEOUT_MS ? "no-speech" : false;
  if (elapsed <= minDurationMs) return false;
  if (level < silenceLevel && quietFor > silenceMs) return "silence";
  return false;
}

// getUserMedia errors are unreadable on their own, so map the ones a user can
// actually act on.
function describeMediaError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return new Error(
        "Microphone access was blocked. Allow the microphone for this site and try again."
      );
    case "NotFoundError":
      return new Error("No microphone was found.");
    case "NotReadableError":
      return new Error(
        "The microphone is already in use by another application."
      );
    default:
      return error;
  }
}

/**
 * Microphone recorder with voice activity detection.
 *
 * Recording stops automatically once the speaker has been quiet for
 * `silenceMs` after speaking, which is what drives the hands free loop.
 */
export function useVoiceRecorder({
  onComplete,
  onDiscard,
  onError,
  deviceId = "",
  silenceMs = 1200,
  maxDurationMs = 60000,
  minDurationMs = 400,
} = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [hasSpeech, setHasSpeech] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceFallback, setDeviceFallback] = useState(false);

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
  const quietestRef = useRef(Infinity);
  const mimeTypeRef = useRef("audio/webm");

  // Keep the latest callbacks without restarting the analyser loop
  const onCompleteRef = useRef(onComplete);
  const onDiscardRef = useRef(onDiscard);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onDiscardRef.current = onDiscard;
    onErrorRef.current = onError;
  }, [onComplete, onDiscard, onError]);

  // Labels are only exposed once microphone permission has been granted
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((device) => device.kind === "audioinput"));
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const onChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () =>
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, [refreshDevices]);

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

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };

    try {
      let stream;
      let usedFallback = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId
            ? { ...audioConstraints, deviceId: { exact: deviceId } }
            : audioConstraints,
        });
      } catch (error) {
        // Browsers rotate device ids between sessions, and an exact match on a
        // stale id is rejected outright without even asking for permission.
        // Falling back to the default device keeps the loop usable.
        const isDeviceMiss =
          error?.name === "OverconstrainedError" ||
          error?.name === "NotFoundError";
        if (!deviceId || !isDeviceMiss) throw error;
        console.warn(
          "Selected microphone is no longer available, using the default device."
        );
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
        usedFallback = true;
      }
      setDeviceFallback(usedFallback);
      streamRef.current = stream;
      // Device labels become readable now that permission was granted
      refreshDevices();
      cancelledRef.current = false;
      forcedRef.current = false;
      chunksRef.current = [];
      hasSpeechRef.current = false;
      smoothedLevelRef.current = 0;
      quietestRef.current = Infinity;
      setHasSpeech(false);

      // Level metering + voice activity detection
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // The context is built after the getUserMedia await, so the click that
      // started the loop no longer counts as a gesture and the context comes
      // up suspended. A suspended context never clocks the analyser, which
      // would freeze the level meter and with it the silence detection.
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.fftSize);

      // The transcription endpoint accepts webm, mp4 and wav alike, so the
      // native recording is sent as is instead of being re-encoded.
      let mimeType = "audio/webm";
      for (const candidate of [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
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

        if (wasCancelled) return;

        // Nothing usable was captured. Report it so the caller can reopen the
        // microphone instead of leaving the loop stalled on a dead turn.
        const blob =
          chunks.length > 0
            ? new Blob(chunks, { type: mimeTypeRef.current })
            : null;
        if (!spoke || !blob || blob.size === 0) {
          onDiscardRef.current?.();
          return;
        }
        onCompleteRef.current?.(blob);
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

        quietestRef.current = Math.min(quietestRef.current, normalized);

        const now = Date.now();
        if (normalized > SPEECH_THRESHOLD) {
          lastSpeechAtRef.current = now;
          if (!hasSpeechRef.current) {
            hasSpeechRef.current = true;
            setHasSpeech(true);
          }
        }

        const reason = shouldEndTake({
          hasSpeech: hasSpeechRef.current,
          level: normalized,
          silenceLevel: silenceLevelFor(quietestRef.current),
          elapsed: now - startedAtRef.current,
          quietFor: now - lastSpeechAtRef.current,
          silenceMs,
          minDurationMs,
          maxDurationMs,
        });
        if (reason) {
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
      onErrorRef.current?.(describeMediaError(error));
    }
  }, [deviceId, maxDurationMs, minDurationMs, refreshDevices, silenceMs, stop, teardown]);

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

  return {
    isRecording,
    level,
    hasSpeech,
    devices,
    deviceFallback,
    refreshDevices,
    start,
    stop,
    cancel,
  };
}
