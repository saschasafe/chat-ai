import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { stripMarkdown } from "../../utils/speech";

// How far from the bottom still counts as "following along"
const FOLLOW_THRESHOLD_PX = 48;

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
  const scrollRef = useRef(null);
  const isFollowingRef = useRef(true);

  const turns = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        (message.role === "user" || message.role === "assistant") &&
        getText(message).trim() !== ""
    );

  // Follow new turns, but leave the view alone once the user scrolls back to
  // read something. scrollTop is set directly so no ancestor gets dragged along.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !isFollowingRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isFollowingRef.current = distanceToBottom <= FOLLOW_THRESHOLD_PX;
  };

  return (
    <div className="flex min-h-[14rem] flex-1 flex-col rounded-xl bg-gray-100 p-3 dark:bg-bg_secondary_dark">
      <p className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wide text-tertiary">
        {t("live_mode.transcript")}
      </p>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto pr-1"
      >
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
                {/* A transcript of a spoken exchange, so the markdown the
                    model wrote for the chat bubble is reduced to prose */}
                <span className="whitespace-pre-line dark:text-white">
                  {stripMarkdown(getText(message))}
                </span>
                {message.loading && (
                  <span className="ml-1 animate-pulse text-tertiary">…</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
