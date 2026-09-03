import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Send, Square, SkipForward, X } from "lucide-react";

import VisionPanel from "./VisionPanel";
import VoiceOrb from "./VoiceOrb";
import LiveTranscript from "./LiveTranscript";
import { useLiveMode } from "./LiveModeContext";

import { useMediaCapture } from "../../hooks/useMediaCapture";
import { useVisionLoop } from "../../hooks/useVisionLoop";
import { useLiveConversation } from "../../hooks/useLiveConversation";
import { useToast } from "../../hooks/useToast";
import {
  getVoicesForLanguage,
  getDefaultVoice,
  hasOwnVoices,
  SPEECH_LANGUAGES,
} from "../../utils/speech";

/**
 * Full screen live mode: hands free voice conversation plus an optional
 * webcam or screen sharing loop. Both halves work on their own and can run
 * at the same time.
 */
export default function LiveModeOverlay({ localState, setLocalState, modelsData = [] }) {
  const { t } = useTranslation();
  const { close, settings, updateSettings } = useLiveMode();
  const { notifyError } = useToast();

  const reportError = useCallback(
    (error) => notifyError(error?.message || String(error)),
    [notifyError]
  );

  const capture = useMediaCapture({ onError: reportError });

  // Only image capable models can drive the frame loop
  const visionModels = useMemo(
    () =>
      (modelsData || []).filter(
        (model) => Array.isArray(model?.input) && model.input.includes("image")
      ),
    [modelsData]
  );

  // Fall back to the first available vision model if none is chosen yet
  useEffect(() => {
    if (visionModels.length === 0) return;
    const isValid = visionModels.some((model) => model.id === settings.visionModel);
    if (!isValid) updateSettings({ visionModel: visionModels[0].id });
  }, [settings.visionModel, updateSettings, visionModels]);

  const visionRunning = capture.isActive && settings.visionEnabled;

  const vision = useVisionLoop({
    captureFrame: capture.captureFrame,
    model: settings.visionModel,
    intervalMs: settings.intervalMs,
    enabled: visionRunning,
    onError: reportError,
  });

  // Only hand observations to the chat model while the loop is actually running
  const getVisionContext = useCallback(
    () => (visionRunning ? vision.getContextText() : ""),
    [vision, visionRunning]
  );

  const live = useLiveConversation({
    localState,
    setLocalState,
    language: settings.language,
    voice: settings.voice,
    audioDeviceId: settings.audioDeviceId,
    getVisionContext,
    onError: reportError,
  });

  const toggleVision = useCallback(async () => {
    if (visionRunning) {
      updateSettings({ visionEnabled: false });
      capture.stop();
      return;
    }
    const started = await capture.start(settings.source, settings.deviceId);
    if (started) updateSettings({ visionEnabled: true });
  }, [capture, settings.deviceId, settings.source, updateSettings, visionRunning]);

  const handleClose = useCallback(() => {
    live.stop();
    capture.stop();
    updateSettings({ visionEnabled: false });
    close();
  }, [capture, close, live, updateSettings]);

  // Escape closes the whole session
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  const voices = getVoicesForLanguage(settings.language);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white/95 backdrop-blur dark:bg-bg_dark/95">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold dark:text-white">
            {t("live_mode.title")}
          </h2>
          <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-medium dark:bg-gray-700 dark:text-white">
            {t(`live_mode.status_${live.status}`)}
          </span>
        </div>
        <button
          type="button"
          className="cursor-pointer rounded-full p-2 hover:bg-gray-200 dark:hover:bg-gray-700"
          onClick={handleClose}
          aria-label={t("common.close")}
        >
          <X className="h-5 w-5 dark:text-white" />
        </button>
      </div>

      {/* Body */}
      {/* The row is pinned to the available height, otherwise it grows with its
          content and the panels inside never get anything to scroll against */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-2 md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
        {/* Vision half */}
        <VisionPanel
          capture={capture}
          settings={settings}
          updateSettings={updateSettings}
          visionModels={visionModels}
          descriptions={vision.descriptions}
          isDescribing={vision.isDescribing}
          lastError={vision.lastError}
          onToggle={toggleVision}
          isRunning={visionRunning}
        />

        {/* Voice half */}
        <div className="flex min-h-0 flex-col gap-3">
          {/* Controls keep their natural height, the transcript takes the rest */}
          <div className="flex shrink-0 flex-col items-center gap-3 rounded-xl bg-gray-100 p-4 dark:bg-bg_secondary_dark">
            <VoiceOrb status={live.status} level={live.level} isActive={live.isActive} />
            <p className="text-center text-sm text-tertiary">
              {t(`live_mode.hint_${live.status}`)}
            </p>

            {/* A live meter, so a muted or wrong microphone is obvious at once */}
            {live.isRecording && (
              <div className="w-full max-w-xs">
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-gray-300 dark:bg-gray-600"
                  role="meter"
                  aria-label={t("live_mode.input_level")}
                >
                  <div
                    className="h-full rounded-full bg-[#009EE0] transition-[width] duration-75"
                    style={{ width: `${Math.min(live.level * 300, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {live.lastError && (
              <p className="text-center text-sm text-red-600 dark:text-red-400">
                {t("live_mode.voice_error", { error: live.lastError })}
              </p>
            )}
            {live.lastWarning && (
              <p className="text-center text-sm text-amber-600 dark:text-amber-400">
                {t(`live_mode.warning_${live.lastWarning}`)}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2">
              {live.isActive ? (
                <>
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600"
                    onClick={live.stop}
                  >
                    <Square className="h-4 w-4" />
                    {t("live_mode.stop_voice")}
                  </button>
                  {live.isSpeaking ? (
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-300 px-4 py-2 text-sm text-black hover:bg-gray-400 dark:bg-gray-600 dark:text-white"
                      onClick={live.interrupt}
                    >
                      <SkipForward className="h-4 w-4" />
                      {t("live_mode.interrupt")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-300 px-4 py-2 text-sm text-black hover:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-600 dark:text-white"
                      onClick={live.endTurn}
                      disabled={!live.isRecording}
                    >
                      <Send className="h-4 w-4" />
                      {t("live_mode.end_turn")}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#009EE0] px-4 py-2 text-sm text-white hover:opacity-90"
                  onClick={live.start}
                >
                  <Mic className="h-4 w-4" />
                  {t("live_mode.start_voice")}
                </button>
              )}
            </div>

            {/* Language and voice picker, independent of the UI language */}
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
              <select
                className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-bg_dark dark:text-white"
                value={settings.language}
                onChange={(event) => {
                  const language = event.target.value;
                  updateSettings({
                    language,
                    voice: getDefaultVoice(language),
                  });
                }}
              >
                {SPEECH_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-bg_dark dark:text-white"
                value={settings.voice}
                onChange={(event) => updateSettings({ voice: event.target.value })}
              >
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </div>
            {/* Microphone picker, disabled while the mic is in use */}
            <div className="flex w-full max-w-xs flex-col gap-1 text-sm">
              <label
                className="text-xs text-tertiary"
                htmlFor="live-mode-microphone"
              >
                {t("live_mode.microphone")}
              </label>
              <select
                id="live-mode-microphone"
                className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-bg_dark dark:text-white"
                value={settings.audioDeviceId}
                disabled={live.isActive}
                onChange={(event) =>
                  updateSettings({ audioDeviceId: event.target.value })
                }
              >
                <option value="">{t("live_mode.default_microphone")}</option>
                {(live.devices || []).map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `${t("live_mode.microphone")} ${index + 1}`}
                  </option>
                ))}
              </select>
              {live.deviceFallback && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("live_mode.microphone_fallback")}
                </p>
              )}
              {live.isActive && (
                <p className="text-xs text-tertiary">
                  {t("live_mode.microphone_locked")}
                </p>
              )}
            </div>
            {!hasOwnVoices(settings.language) && (
              <p className="text-center text-xs text-tertiary">
                {t("live_mode.voice_fallback")}
              </p>
            )}
          </div>

          <LiveTranscript messages={localState.messages} />
        </div>
      </div>
    </div>
  );
}
