"use client";

import { useEffect, useMemo, useState } from "react";

type Message = {
  from: "bot" | "user";
  text: string;
};

const defaultMessages: Message[] = [
  {
    from: "bot",
    text: "Hi, I can help refine your lead search by state, distance, and insurance segment."
  }
];

const CHAT_MEMORY_KEY = "lead-assistant-chat-memory-v1";
const MAX_STORED_MESSAGES = 40;

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { from?: unknown; text?: unknown };
  return (
    (candidate.from === "bot" || candidate.from === "user") &&
    typeof candidate.text === "string"
  );
}

function toStoredMessages(messages: Message[]): Message[] {
  const trimmed = messages.slice(-MAX_STORED_MESSAGES);
  return trimmed.length > 0 ? trimmed : defaultMessages;
}

export function FloatingChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(defaultMessages);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHAT_MEMORY_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return;
      }

      const restored = parsed.filter(isMessage);
      if (restored.length > 0) {
        setMessages(toStoredMessages(restored));
      }
    } catch {
      // Ignore malformed local storage payloads.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_MEMORY_KEY, JSON.stringify(toStoredMessages(messages)));
    } catch {
      // Ignore storage quota/privacy mode failures.
    }
  }, [messages]);

  const canSend = useMemo(() => input.trim().length > 0, [input]);

  const clearChat = () => {
    setMessages(defaultMessages);
    setInput("");
    try {
      window.localStorage.removeItem(CHAT_MEMORY_KEY);
    } catch {
      // Ignore storage access errors.
    }
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    setMessages((prev) => toStoredMessages([...prev, { from: "user", text: trimmed }]));
    setInput("");

    setIsFetching(true);
    try {
      const response = await fetch("/api/leads/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          limit: 4,
          searchAllIndexes: true,
        })
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as {
          error?: string;
          detail?: string;
        };
        throw new Error(
          errorPayload.detail ??
            errorPayload.error ??
            `Request failed with status ${response.status}`
        );
      }

      const payload = (await response.json()) as {
        answer?: string;
        warning?: string;
        matches?: Array<{
          index_name?: string;
          id?: string;
          score?: number;
          title?: string;
          snippet?: string;
          company_name?: string;
          email_message?: string;
          website?: string;
          industry?: string;
          why_match?: string;
          contact_name?: string;
          contact_title?: string;
          contact_email?: string;
          contact_phone?: string;
          state?: string;
        }>;
      };

      const matches = payload.matches ?? [];
      if (matches.length === 0) {
        setMessages((prev) => toStoredMessages([
          ...prev,
          {
            from: "bot",
            text: payload.answer ?? "I don't have information"
          }
        ]));
        return;
      }

      const top = matches
        .map((item, idx) => {
          const score = typeof item.score === "number" ? item.score.toFixed(3) : "n/a";
          const snippet = (item.snippet ?? "").slice(0, 180).replace(/\s+/g, " ");
          return `${idx + 1}) ${item.title ?? "Result"} [index:${item.index_name ?? "unknown"}] id:${item.id ?? "n/a"} score:${score} - ${snippet}`;
        })
        .join("\n");

      const responseText = payload.answer
        ? payload.answer
        : `Retrieved context from Azure AI Search:\n${top}`;

      setMessages((prev) => toStoredMessages([
        ...prev,
        {
          from: "bot",
          text: responseText
        }
      ]));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessages((prev) => toStoredMessages([
        ...prev,
        {
          from: "bot",
          text: `Could not fetch Azure AI Search results (${message}).`
        }
      ]));
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="chat-shell" aria-live="polite">
      <button
        className="chat-toggle"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Close assistant chat" : "Open assistant chat"}
      >
        {isOpen ? "-" : "AI"}
      </button>

      {isOpen ? (
        <div className="chat-panel">
          <div className="chat-head">
            <span>Lead Agent Assistant</span>
            <button
              className="chat-clear-btn"
              type="button"
              onClick={clearChat}
              disabled={isFetching}
            >
              Clear Chat
            </button>
          </div>
          <div className="chat-body">
            {messages.map((msg, idx) => (
              <div className={`msg ${msg.from}`} key={`${msg.from}-${idx}`}>
                {msg.text}
              </div>
            ))}
          </div>
          <div className="chat-input-row">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  sendMessage();
                }
              }}
              placeholder="Ask to refine leads..."
            />
            <button type="button" onClick={sendMessage} disabled={!canSend}>
              {isFetching ? "..." : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
