import { inArray } from "drizzle-orm";
import { users, type messages } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
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
  /** Staff member who sent it (staff screens only; the patient sees the clinic). */
  sentByName: string | null;
  /** A photo the patient sent: its URL for doctors/admins, "hidden" for reception. */
  photo: { url: string } | "hidden" | null;
}

/** What the chat screens may show (button ids stay: the simulator taps them). */
export function messageView(
  m: typeof messages.$inferSelect,
  lang: "ar" | "en",
  opts: { names?: Map<string, string>; canSeePhotos?: boolean } = {},
): ChatMessageView {
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
    sentByName: m.sentBy ? (opts.names?.get(m.sentBy) ?? null) : null,
    photo: m.fileId ? (opts.canSeePhotos ? { url: `/api/files/${m.fileId}` } : "hidden") : null,
  };
}

/** Staff names for "who replied" (Arabic name, English if the screen is in English). */
export async function senderNames(
  tx: TenantTx,
  msgs: { sentBy: string | null }[],
  lang: "ar" | "en",
  extra: (string | null)[] = [],
) {
  const ids = [
    ...new Set([...msgs.map((m) => m.sentBy), ...extra].filter((x): x is string => !!x)),
  ];
  if (!ids.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: users.id, name: users.name, nameEn: users.nameEn })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, lang === "en" && r.nameEn ? r.nameEn : r.name]));
}
