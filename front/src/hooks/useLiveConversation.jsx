import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../apis/audioTranscriptions";
import { useSendMessage } from "./useSendMessage";
import { useSpeechPlayback } from "./useSpeechPlayback";
import { useVoiceRecorder } from "./useVoiceRecorder";

/**
 * Drives the hands free loop: listen, transcribe, send into the real
 * conversation, then speak the reply and listen again.
 *
 * Everything is written into `localState`, so live mode turns show up in the
 * normal chat history and are persisted like any other message.
 */
export function useLiveConversation({
  localState,
  setLocalState,
  language = "en",
  voice,
  audioDeviceId = "",
  sttModel = "whisper-large-v2",
  ttsModel,
  getVisionContext = null,
  onError,
}) {
  const sendMessage = useSendMessage();

  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | listening | transcribing | thinking | speaking
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastError, setLastError] = useState(null);
  // Translation key for a spent turn that was not worth sending
  const [lastWarning, setLastWarning] = useState(null);

  const isActiveRef = useRef(false);
  const awaitingIndexRef = useRef(null);
  const conversationIdRef = useRef(localState?.id);
  const [shouldSend, setShouldSend] = useState(false);

  const onErrorRef = useRef(onError);
  const getVisionContextRef = useRef(getVisionContext);
  useEffect(() => {
    onErrorRef.current = onError;
    getVisionContextRef.current = getVisionContext;
  }, [getVisionContext, onError]);

  const reportError = useCallback((error) => {
    console.error("Live mode error:", error);
    setLastError(error?.message || String(error));
    onErrorRef.current?.(error);
  }, []);

  const { isSpeaking, speak, stop: stopSpeaking } = useSpeechPlayback({
    onError: reportError,
    onFinished: () => nextTurn(),
  });

  // Put the transcript into the pending user message, then let the effect send
  const submitTranscript = useCallback(
    (text) => {
      const visionContext = getVisionContextRef.current?.() || "";
      awaitingIndexRef.current = localState.messages.length;
      conversationIdRef.current = localState.id;
      setStatus("thinking");
      setLocalState((prev) => {
        const messages = [...prev.messages];
        const last = messages[messages.length - 1];
        const attachments = (last?.content || []).slice(1);
        messages[messages.length - 1] = {
          role: "user",
          content: [
            { type: "text", text },
            ...attachments,
            // Observations travel with the message but are not shown in the bubble
            ...(visionContext ? [{ type: "text", text: visionContext }] : []),
          ],
        };
        return { ...prev, messages, choices: [] };
      });
      setShouldSend(true);
    },
    [localState.id, localState.messages.length, setLocalState]
  );

  const handleRecording = useCallback(
    async (wavBlob) => {
      if (!isActiveRef.current) return;
      setStatus("transcribing");
      try {
        const text = await transcribeAudio({
          audioBlob: wavBlob,
          model: sttModel,
          language,
        });
        if (!text) {
          // Nothing intelligible came back, so hand the turn back
          setLastWarning("nothing_understood");
          nextTurn();
          return;
        }
        setLastTranscript(text);
        submitTranscript(text);
      } catch (error) {
        reportError(error);
        nextTurn();
      }
    },
    // startListening is defined below and stable through the recorder ref
    [language, reportError, sttModel, submitTranscript]
  );

  const recorder = useVoiceRecorder({
    deviceId: audioDeviceId,
    onComplete: handleRecording,
    // The take held nothing usable, so say why and hand the turn back
    onDiscard: (reason) => {
      if (reason === "no-input") setLastWarning("no_input");
      else if (reason === "no-speech") setLastWarning("nothing_understood");
      nextTurn();
    },
    onError: (error) => {
      reportError(error);
      setStatus("idle");
      setIsActive(false);
      isActiveRef.current = false;
    },
  });

  const recorderRef = useRef(recorder);
  useEffect(() => {
    recorderRef.current = recorder;
  }, [recorder]);

  function startListening() {
    setLastWarning(null);
    setStatus("listening");
    recorderRef.current.start();
  }

  // Reopen the microphone once a take is spent, or fall idle if the loop
  // was stopped in the meantime
  function nextTurn() {
    if (isActiveRef.current) startListening();
    else setStatus("idle");
  }

  // Send once localState carries the transcript
  useEffect(() => {
    if (!shouldSend) return;
    setShouldSend(false);
    sendMessage({ localState, setLocalState });
  }, [shouldSend, localState.messages]);

  // Speak the reply as soon as it is complete
  useEffect(() => {
    const index = awaitingIndexRef.current;
    if (index == null) return;
    if (localState.id !== conversationIdRef.current) {
      awaitingIndexRef.current = null;
      return;
    }
    const message = localState.messages[index];
    if (!message || message.role !== "assistant" || message.loading) return;

    awaitingIndexRef.current = null;
    const content = message.content;
    const text = Array.isArray(content)
      ? content.find((item) => item.type === "text")?.text || ""
      : content || "";

    if (!text.trim()) {
      nextTurn();
      return;
    }
    if (!isActiveRef.current) {
      setStatus("idle");
      return;
    }
    setStatus("speaking");
    speak({ text, voice, model: ttsModel });
  }, [localState.messages, speak, ttsModel, voice]);

  const start = useCallback(() => {
    setLastError(null);
    setLastWarning(null);
    isActiveRef.current = true;
    setIsActive(true);
    startListening();
  }, []);

  const stop = useCallback(() => {
    isActiveRef.current = false;
    setIsActive(false);
    awaitingIndexRef.current = null;
    recorderRef.current.cancel();
    stopSpeaking();
    setStatus("idle");
  }, [stopSpeaking]);

  // Cut the reply short and take the next turn immediately
  const interrupt = useCallback(() => {
    stopSpeaking();
    nextTurn();
  }, [stopSpeaking]);

  // End the current take and send it. `force` submits even when the detector
  // never flagged speech, so quiet talkers are not silently dropped, but a
  // take with no signal at all is still held back by the recorder.
  const endTurn = useCallback(() => {
    recorderRef.current.stop({ force: true });
  }, []);

  useEffect(() => {
    return () => {
      isActiveRef.current = false;
    };
  }, []);

  return {
    isActive,
    status,
    level: recorder.level,
    isRecording: recorder.isRecording,
    devices: recorder.devices,
    deviceFallback: recorder.deviceFallback,
    isSpeaking,
    lastTranscript,
    lastError,
    lastWarning,
    start,
    stop,
    interrupt,
    endTurn,
  };
}
