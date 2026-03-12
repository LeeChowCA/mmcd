"use client";

import Image from "next/image";

type AgentWidgetHeaderProps = {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
};

export function AgentWidgetHeader({ isExpanded, onToggleExpanded, onClose }: AgentWidgetHeaderProps) {
  return (
    <header className="agentWidgetHeader">
      <div className="agentHeaderIdentity">
        <div className="agentHeaderAvatar" aria-hidden="true">
          <Image src="/scale_technics.png" alt="" width={36} height={36} />
        </div>
      </div>

      <div className="agentWidgetHeaderActions">
        <button
          type="button"
          className="agentWidgetIconButton"
          onClick={onToggleExpanded}
          aria-label={isExpanded ? "Collapse chat" : "Expand chat"}
          title={isExpanded ? "Collapse chat" : "Expand chat"}
        >
          {isExpanded ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9 9H7M9 9V7M15 9H17M15 9V7M9 15H7M9 15V17M15 15H17M15 15V17"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 9L5 5M15 9l4-4M9 15l-4 4M15 15l4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 5H8M5 5V8M19 5H16M19 5V8M5 19H8M5 19V16M19 19H16M19 19V16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="agentWidgetClose"
          onClick={onClose}
          aria-label="Close chat"
          title="Close chat"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 6l12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
