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
  sttModel = "whisper-large-v2",
  ttsModel,
  getVisionContext = null,
  onError,
}) {
  const sendMessage = useSendMessage();

  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | listening | transcribing | thinking | speaking
  const [lastTranscript, setLastTranscript] = useState("");

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
    onErrorRef.current?.(error);
  }, []);

  const { isSpeaking, speak, stop: stopSpeaking } = useSpeechPlayback({
    onError: reportError,
    onFinished: () => {
      // Reopen the mic for the next turn
      if (isActiveRef.current) startListening();
      else setStatus("idle");
    },
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
          // Nothing intelligible, just listen again
          if (isActiveRef.current) startListening();
          return;
        }
        setLastTranscript(text);
        submitTranscript(text);
      } catch (error) {
        reportError(error);
        if (isActiveRef.current) startListening();
      }
    },
    // startListening is defined below and stable through the recorder ref
    [language, reportError, sttModel, submitTranscript]
  );

  const recorder = useVoiceRecorder({
    onComplete: handleRecording,
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
    setStatus("listening");
    recorderRef.current.start();
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

    if (!isActiveRef.current) {
      setStatus("idle");
      return;
    }
    if (!text.trim()) {
      startListening();
      return;
    }
    setStatus("speaking");
    speak({ text, voice, model: ttsModel });
  }, [localState.messages, speak, ttsModel, voice]);

  const start = useCallback(() => {
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
    if (isActiveRef.current) startListening();
    else setStatus("idle");
  }, [stopSpeaking]);

  // Force the current turn to end without waiting for the silence timeout
  const endTurn = useCallback(() => {
    recorderRef.current.stop();
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
    isSpeaking,
    lastTranscript,
    start,
    stop,
    interrupt,
    endTurn,
  };
}
