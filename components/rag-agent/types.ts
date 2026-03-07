export type ChatRole = "user" | "assistant";

export type Citation = {
  id: number;
  url?: string;
  label?: string;
  page?: number;
  sourceId?: string;
  pageId?: string;
  sourceFile?: string;
  excerpt?: string;
  matchedText?: string;
  score?: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status?: "streaming" | "done" | "error";
  citations?: Citation[];
  suggestedQuestions?: string[];
};

export type AgentResponse =
  | string
  | {
      answer?: unknown;
      reply?: unknown;
      output?: unknown;
      message?: unknown;
      citations?: unknown;
      suggested_questions?: unknown;
      suggestedQuestions?: unknown;
      follow_up_questions?: unknown;
      followUpQuestions?: unknown;
      messages?: Array<{ role?: unknown; content?: unknown; citations?: unknown }>;
    };

export type StreamEvent = {
  event?: unknown;
  type?: unknown;
  text?: unknown;
  delta?: unknown;
  token?: unknown;
  chunk?: unknown;
  answer?: unknown;
  output?: unknown;
  message?: unknown;
  citations?: unknown;
  suggested_questions?: unknown;
  suggestedQuestions?: unknown;
  follow_up_questions?: unknown;
  followUpQuestions?: unknown;
};

export type StreamAgentEventPayload = {
  deltaText?: string;
  citations?: Citation[];
  suggestedQuestions?: string[];
};
