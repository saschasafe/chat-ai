import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

function getText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  // The first text item is the spoken turn, later ones carry live context
  return content.find((item) => item.type === "text")?.text || "";
}

// Live view of the conversation this session is writing into
export default function LiveTranscript({ messages }) {
  const { t } = useTranslation();
  const bottomRef = useRef(null);

  const turns = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        (message.role === "user" || message.role === "assistant") &&
        getText(message).trim() !== ""
    )
    .slice(-12);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl bg-gray-100 p-3 dark:bg-bg_secondary_dark">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-tertiary">
        {t("live_mode.transcript")}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {turns.length === 0 ? (
          <p className="text-sm text-tertiary">{t("live_mode.no_transcript")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {turns.map(({ message, index }) => (
              <li key={index} className="text-sm">
                <span className="mr-2 text-xs font-semibold uppercase text-tertiary">
                  {message.role === "user"
                    ? t("live_mode.you")
                    : t("live_mode.assistant")}
                </span>
                <span className="dark:text-white">
                  {/* Reasoning blocks are not part of the spoken reply */}
                  {getText(message).replace(/<think>[\s\S]*?<\/think>/g, "").trim()}
                </span>
                {message.loading && (
                  <span className="ml-1 animate-pulse text-tertiary">…</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
