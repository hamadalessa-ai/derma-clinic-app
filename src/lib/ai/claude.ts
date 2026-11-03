/**
 * A minimal client for the Claude Messages API (plain fetch, no SDK — same style as the Meta
 * WhatsApp adapter). Supports tool use. Tests pass their own ClaudeClient with scripted answers.
 *
 * Settings (Vercel → Environment Variables):
 *   ANTHROPIC_API_KEY  the clinic's API key (secret). Without it, the AI receptionist is off.
 *   ANTHROPIC_MODEL    optional; default DEFAULT_MODEL below (fast and low-cost).
 */
type Env = Record<string, string | undefined>;

export const DEFAULT_MODEL = "claude-haiku-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ClaudeRequest {
  system: string;
  messages: ClaudeMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}

export interface ClaudeResponse {
  content: ContentBlock[];
  stopReason: string;
}

export interface ClaudeClient {
  create(req: ClaudeRequest): Promise<ClaudeResponse>;
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The real client, or null when no API key is set. */
export function anthropicClient(env: Env = process.env): ClaudeClient | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  return {
    async create(req) {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 700,
          system: req.system,
          messages: req.messages,
          tools: req.tools,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const body = (await res.json().catch(() => null)) as {
        content?: ContentBlock[];
        stop_reason?: string;
        error?: { type?: string; message?: string };
      } | null;
      if (!res.ok || !body?.content) {
        // Never include the key; the API's own message says what went wrong (e.g. no credit).
        throw new ClaudeError(
          `Claude API ${res.status}: ${body?.error?.type ?? "error"} ${body?.error?.message ?? ""}`.trim(),
          res.status,
        );
      }
      return { content: body.content, stopReason: body.stop_reason ?? "end_turn" };
    },
  };
}
