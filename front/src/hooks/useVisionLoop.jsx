import { useCallback, useEffect, useRef, useState } from "react";
import { describeFrame } from "../apis/describeFrame";

const MAX_ENTRIES = 40; // Keep the log bounded, it only feeds context and the UI

/**
 * Periodically sends a captured frame to a vision model and keeps a rolling
 * log of descriptions. Each request carries the previous descriptions as
 * context, so the model can report what changed.
 */
export function useVisionLoop({
  captureFrame,
  model,
  intervalMs = 4000,
  enabled = false,
  onError,
}) {
  const [descriptions, setDescriptions] = useState([]);
  const [isDescribing, setIsDescribing] = useState(false);
  const [lastError, setLastError] = useState(null);

  const descriptionsRef = useRef([]);
  const inFlightRef = useRef(false);
  const timerRef = useRef(null);

  const onErrorRef = useRef(onError);
  const captureFrameRef = useRef(captureFrame);
  useEffect(() => {
    onErrorRef.current = onError;
    captureFrameRef.current = captureFrame;
  }, [captureFrame, onError]);

  const clear = useCallback(() => {
    descriptionsRef.current = [];
    setDescriptions([]);
    setLastError(null);
  }, []);

  const runOnce = useCallback(async () => {
    // Skip this tick if the previous request has not come back yet
    if (inFlightRef.current || !model) return null;
    const dataUrl = captureFrameRef.current?.();
    if (!dataUrl) return null;

    inFlightRef.current = true;
    setIsDescribing(true);
    try {
      const text = await describeFrame({
        dataUrl,
        model,
        previousDescriptions: descriptionsRef.current.map((entry) => entry.text),
      });
      if (text) {
        const entry = { text, at: Date.now() };
        descriptionsRef.current = [...descriptionsRef.current, entry].slice(
          -MAX_ENTRIES
        );
        setDescriptions(descriptionsRef.current);
        setLastError(null);
      }
      return text;
    } catch (error) {
      setLastError(error?.message || String(error));
      onErrorRef.current?.(error);
      return null;
    } finally {
      inFlightRef.current = false;
      setIsDescribing(false);
    }
  }, [model]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    runOnce();
    timerRef.current = setInterval(runOnce, Math.max(1000, intervalMs));
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, intervalMs, runOnce]);

  // Context block handed to the chat model when a message is sent
  const getContextText = useCallback((limit = 8) => {
    const recent = descriptionsRef.current.slice(-limit);
    if (recent.length === 0) return "";
    const lines = recent.map(
      (entry, index) =>
        `${index + 1}. [${new Date(entry.at).toLocaleTimeString()}] ${entry.text}`
    );
    return (
      "--- Begin Live Video Observations ---\n" +
      "These descriptions come from a live camera or screen feed the user is sharing, " +
      "ordered from oldest to newest:\n" +
      lines.join("\n") +
      "\n--- End Live Video Observations ---"
    );
  }, []);

  return {
    descriptions,
    isDescribing,
    lastError,
    runOnce,
    clear,
    getContextText,
  };
}
