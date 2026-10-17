import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import bcrypt from "bcryptjs";
import { getDb } from "@/db/client";
import { accounts, sessions, users, verifications } from "@/db/schema";

/** Hosts the app may be reached on (local subdomains, the configured root domain, Vercel URLs). */
export function allowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = env.APP_ROOT_DOMAIN ?? "localhost";
  const hosts = new Set<string>([root, `*.${root}`, `${root}:*`, `*.${root}:*`]);
  for (const v of [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.VERCEL_URL]) {
    if (v) hosts.add(v);
  }
  if (env.BETTER_AUTH_URL) hosts.add(new URL(env.BETTER_AUTH_URL).host);
  return [...hosts];
}

function createAuth() {
  return betterAuth({
    appName: "Clinic Platform",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: {
      allowedHosts: allowedHosts(),
      protocol: process.env.NODE_ENV === "production" ? "https" : "auto",
    },
    trustedOrigins: allowedHosts().flatMap((h) => [`https://${h}`, `http://${h}`]),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // staff accounts are created by clinic admins, never self-service
      minPasswordLength: 10,
      // bcrypt, so db/setup.sql can create demo passwords inside Postgres with pgcrypto.
      password: {
        hash: (password) => bcrypt.hash(password, 10),
        verify: ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },
    user: {
      additionalFields: {
        isPlatformOwner: { type: "boolean", required: false, defaultValue: false, input: false },
        nameEn: { type: "string", required: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 12, // 12 hours: one working day
      updateAge: 60 * 60,
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __auth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__auth ??= createAuth();
  return globalForAuth.__auth;
}
