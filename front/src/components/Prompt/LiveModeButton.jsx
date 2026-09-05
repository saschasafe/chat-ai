import { useTranslation } from "react-i18next";
import { Radio } from "lucide-react";

import Tooltip from "../Others/Tooltip";
import { useLiveMode } from "../LiveMode/LiveModeContext";

// Opens the full screen live mode (voice conversation and camera or screen)
export default function LiveModeButton({ localState }) {
  const { t } = useTranslation();
  const { open } = useLiveMode();

  const loading =
    localState.messages[localState.messages.length - 2]?.role === "assistant"
      ? localState.messages[localState.messages.length - 2]?.loading || false
      : false;

  return (
    <Tooltip text={t("live_mode.open")}>
      <button
        className="h-[25px] w-[25px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        onClick={() => open()}
        disabled={loading}
        aria-label={t("live_mode.open")}
      >
        <Radio className="h-[25px] w-[25px] text-[#009EE0]" />
      </button>
    </Tooltip>
  );
}
