import { Loader2, Mic, MicOff, Volume2 } from "lucide-react";

const STATUS_STYLES = {
  idle: "bg-gray-200 dark:bg-gray-700",
  listening: "bg-[#009EE0]",
  transcribing: "bg-amber-500",
  thinking: "bg-violet-500",
  speaking: "bg-emerald-500",
};

// Pulsing indicator that reflects the current stage of the voice loop
export default function VoiceOrb({ status, level = 0, isActive }) {
  // Clamp the mic level so a loud room cannot blow up the layout
  const scale = status === "listening" ? 1 + Math.min(level, 0.5) * 0.9 : 1;

  return (
    <div className="relative flex h-40 w-40 items-center justify-center">
      {/* Reactive halo */}
      <div
        className={`absolute rounded-full opacity-30 transition-transform duration-75 ${
          STATUS_STYLES[status] || STATUS_STYLES.idle
        }`}
        style={{
          height: "10rem",
          width: "10rem",
          transform: `scale(${scale})`,
        }}
      />
      <div
        className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg ${
          STATUS_STYLES[status] || STATUS_STYLES.idle
        } ${status === "speaking" ? "animate-pulse" : ""}`}
      >
        {status === "transcribing" || status === "thinking" ? (
          <Loader2 className="h-9 w-9 animate-spin" />
        ) : status === "speaking" ? (
          <Volume2 className="h-9 w-9" />
        ) : isActive ? (
          <Mic className="h-9 w-9" />
        ) : (
          <MicOff className="h-9 w-9 text-gray-500 dark:text-gray-300" />
        )}
      </div>
    </div>
  );
}
