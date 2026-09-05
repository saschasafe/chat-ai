import { useTranslation } from "react-i18next";
import { Camera, Eye, Loader2, MonitorUp, VideoOff } from "lucide-react";

const INTERVAL_OPTIONS = [2000, 4000, 8000, 15000];

/**
 * Live preview of the shared webcam or screen, its source controls and the
 * rolling descriptions produced by the vision model.
 */
export default function VisionPanel({
  capture,
  settings,
  updateSettings,
  visionModels,
  descriptions,
  isDescribing,
  lastError,
  onToggle,
  isRunning,
}) {
  const { t } = useTranslation();
  // Newest first, and the whole retained log so the list is worth scrolling
  const recent = [...descriptions].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Source and model controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
          <button
            type="button"
            className={`flex items-center gap-1 px-3 py-1.5 text-sm ${
              settings.source === "camera"
                ? "bg-[#009EE0] text-white"
                : "bg-white text-black dark:bg-bg_secondary_dark dark:text-white"
            }`}
            onClick={() => {
              updateSettings({ source: "camera" });
              capture.selectSource("camera");
            }}
          >
            <Camera className="h-4 w-4" />
            {t("live_mode.source_camera")}
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 px-3 py-1.5 text-sm ${
              settings.source === "screen"
                ? "bg-[#009EE0] text-white"
                : "bg-white text-black dark:bg-bg_secondary_dark dark:text-white"
            }`}
            onClick={() => {
              updateSettings({ source: "screen" });
              capture.selectSource("screen");
            }}
          >
            <MonitorUp className="h-4 w-4" />
            {t("live_mode.source_screen")}
          </button>
        </div>

        {/* Webcam picker, only meaningful for the camera source */}
        {settings.source === "camera" && (
          <select
            className="max-w-[14rem] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-bg_secondary_dark dark:text-white"
            value={capture.deviceId}
            onChange={(event) => {
              updateSettings({ deviceId: event.target.value });
              capture.selectDevice(event.target.value);
            }}
            onFocus={() => capture.refreshDevices()}
          >
            <option value="">{t("live_mode.default_camera")}</option>
            {capture.devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `${t("live_mode.source_camera")} ${index + 1}`}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-white ${
            isRunning ? "bg-red-500 hover:bg-red-600" : "bg-[#009EE0] hover:opacity-90"
          }`}
          onClick={onToggle}
        >
          {isRunning ? (
            <>
              <VideoOff className="h-4 w-4" />
              {t("live_mode.stop_vision")}
            </>
          ) : (
            <>
              <Eye className="h-4 w-4" />
              {t("live_mode.start_vision")}
            </>
          )}
        </button>
      </div>

      {/* Preview. Height capped so a wide column cannot squeeze the log away,
          the video letterboxes itself inside whatever is left. */}
      <div className="relative aspect-video max-h-[40vh] w-full shrink-0 overflow-hidden rounded-xl bg-black">
        <video
          ref={capture.videoRef}
          className={`h-full w-full object-contain ${
            settings.source === "camera" ? "scale-x-[-1]" : ""
          }`}
          playsInline
          muted
        />
        {!capture.isActive && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            {t("live_mode.no_stream")}
          </div>
        )}
        {isDescribing && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("live_mode.analyzing")}
          </div>
        )}
      </div>

      {/* Vision model and sampling interval */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-tertiary">{t("live_mode.vision_model")}</label>
        <select
          className="min-w-[12rem] rounded-lg border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-bg_secondary_dark dark:text-white"
          value={settings.visionModel}
          onChange={(event) => updateSettings({ visionModel: event.target.value })}
        >
          {visionModels.length === 0 && (
            <option value="">{t("live_mode.no_vision_model")}</option>
          )}
          {visionModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name || model.id}
            </option>
          ))}
        </select>

        <label className="text-tertiary">{t("live_mode.interval")}</label>
        <select
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-bg_secondary_dark dark:text-white"
          value={settings.intervalMs}
          onChange={(event) =>
            updateSettings({ intervalMs: Number(event.target.value) })
          }
        >
          {INTERVAL_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value / 1000}s
            </option>
          ))}
        </select>
      </div>

      {lastError && (
        <p className="text-sm text-red-500">
          {t("live_mode.vision_error", { error: lastError })}
        </p>
      )}

      {/* Rolling observations, newest first. The heading stays put while only
          the list scrolls. */}
      <div className="flex min-h-[14rem] flex-1 flex-col rounded-xl bg-gray-100 p-3 dark:bg-bg_secondary_dark">
        <p className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wide text-tertiary">
          {t("live_mode.observations")}
        </p>
        {recent.length === 0 ? (
          <p className="text-sm text-tertiary">{t("live_mode.no_observations")}</p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {recent.map((entry) => (
              <li key={entry.at} className="text-sm dark:text-white">
                <span className="mr-2 text-xs text-tertiary">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
                {entry.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
