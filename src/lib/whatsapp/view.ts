import type { messages } from "@/db/schema";
import { explainError } from "./errors";

export interface ChatMessageView {
  id: string;
  direction: "in" | "out";
  kind: string;
  body: string;
  buttons: { id: string; title: string }[];
  buttonId: string | null;
  status: string;
  errorCode: string | null;
  errorText: string | null;
  errorExplained: string | null;
  flag: string | null;
  createdAt: string;
  channel: string;
}

/** What the chat screens may show (button ids stay: the simulator taps them). */
export function messageView(m: typeof messages.$inferSelect, lang: "ar" | "en"): ChatMessageView {
  return {
    id: m.id,
    direction: m.direction === "in" ? "in" : "out",
    kind: m.kind,
    body: m.body,
    buttons: m.buttons ?? [],
    buttonId: m.buttonId,
    status: m.status,
    errorCode: m.errorCode,
    errorText: m.errorText,
    errorExplained: explainError(m.errorCode, lang),
    flag: m.flag,
    createdAt: m.createdAt.toISOString(),
    channel: m.channel,
  };
}
