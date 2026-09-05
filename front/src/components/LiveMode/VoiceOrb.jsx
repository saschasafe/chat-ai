import { Loader2, Mic, MicOff, Volume2 } from "lucide-react";

const STATUS_STYLES = {
  idle: "bg-gray-200 dark:bg-gray-700",
  listening: "bg-[#009EE0]",
  transcribing: "bg-amber-500",
  thinking: "bg-violet-500",
  speaking: "bg-emerald-500",
};

// Speech RMS rarely passes ~0.3, so the meter is amplified to fill the ring
const LEVEL_GAIN = 3;

// Pulsing indicator that reflects the current stage of the voice loop
export default function VoiceOrb({ status, level = 0, isActive }) {
  const isListening = status === "listening";
  // Clamp the amplified level so a loud room cannot blow up the layout
  const amplified = isListening ? Math.min(level * LEVEL_GAIN, 1) : 0;
  const color = STATUS_STYLES[status] || STATUS_STYLES.idle;

  return (
    <div className="relative flex h-40 w-40 items-center justify-center">
      {/* Outer halo, driven by the microphone level */}
      <div
        className={`absolute rounded-full transition-transform duration-100 ease-out ${color}`}
        style={{
          height: "10rem",
          width: "10rem",
          opacity: 0.18 + amplified * 0.22,
          transform: `scale(${0.62 + amplified * 0.38})`,
        }}
      />
      {/* Inner halo reacts harder, so quiet speech is still visible */}
      <div
        className={`absolute rounded-full transition-transform duration-75 ease-out ${color}`}
        style={{
          height: "7rem",
          width: "7rem",
          opacity: 0.3 + amplified * 0.3,
          transform: `scale(${0.9 + amplified * 0.45})`,
        }}
      />
      {/* While listening but silent, a slow breath shows the mic is live */}
      <div
        className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg ${color} ${
          status === "speaking" || (isListening && amplified < 0.05)
            ? "animate-pulse"
            : ""
        }`}
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
