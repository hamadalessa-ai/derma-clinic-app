/**
 * The video service behind virtual consultations. One small interface, so the provider can be
 * swapped later (e.g. a self-hosted LiveKit/Jitsi server in Saudi Arabia) without touching the
 * rest of the app. Today: Daily (daily.co), plain fetch, no SDK — like the WhatsApp adapter.
 *
 * Settings (Vercel → Environment Variables):
 *   DAILY_API_KEY  the clinic's Daily API key (secret). Without it, video is "not connected yet".
 *   DAILY_GEO      optional call-server region (e.g. "ap-south-1" = Mumbai); default: nearest.
 *
 * Privacy: rooms are private (a personal join token is needed), never recorded, closed after
 * the visit; the room name is a code that says nothing about the patient.
 */
type Env = Record<string, string | undefined>;

export interface VideoProvider {
  /** Creates the room, or updates its open/close times when it already exists. Returns its URL. */
  ensureRoom(input: { name: string; opensAt: Date; closesAt: Date }): Promise<string>;
  /** A personal, time-limited pass into one room. */
  joinToken(input: {
    room: string;
    userName: string;
    owner: boolean;
    expiresAt: Date;
  }): Promise<string>;
}

export class VideoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VideoError";
  }
}

const API = "https://api.daily.co/v1";
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

/** The real provider, or null when no key is set. */
export function videoProvider(env: Env = process.env): VideoProvider | null {
  const key = env.DAILY_API_KEY?.trim();
  if (!key) return null;
  const geo = env.DAILY_GEO?.trim() || null;

  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, ok: res.ok, json };
  }
  const fail = (what: string, r: { status: number; json: Record<string, unknown> | null }) =>
    // Never include the key; Daily's own message says what went wrong.
    new VideoError(
      `Daily ${what} ${r.status}: ${String(r.json?.error ?? "error")} ${String(r.json?.info ?? "")}`.trim(),
      r.status,
    );

  return {
    async ensureRoom({ name, opensAt, closesAt }) {
      const properties = {
        nbf: secs(opensAt),
        exp: secs(closesAt),
        eject_at_room_exp: true,
        enable_prejoin_ui: true,
        enable_chat: true,
        enable_screenshare: true,
        max_participants: 4,
        lang: "user",
        ...(geo ? { geo } : {}),
      };
      // Update first (the visit may have moved); create when it doesn't exist yet.
      const updated = await call("POST", `/rooms/${encodeURIComponent(name)}`, { properties });
      if (updated.ok && typeof updated.json?.url === "string") return updated.json.url;
      if (updated.status !== 404) throw fail("update room", updated);
      const created = await call("POST", "/rooms", { name, privacy: "private", properties });
      if (created.ok && typeof created.json?.url === "string") return created.json.url;
      throw fail("create room", created);
    },
    async joinToken({ room, userName, owner, expiresAt }) {
      const r = await call("POST", "/meeting-tokens", {
        properties: {
          room_name: room,
          user_name: userName.slice(0, 60),
          is_owner: owner,
          exp: secs(expiresAt),
          eject_at_token_exp: true,
          enable_prejoin_ui: true,
          lang: "user",
        },
      });
      if (r.ok && typeof r.json?.token === "string") return r.json.token;
      throw fail("token", r);
    },
  };
}
