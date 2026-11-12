import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import bcrypt from "bcryptjs";
import { getDb } from "@/db/client";
import { accounts, sessions, twoFactors, users, verifications } from "@/db/schema";

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
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
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
    // Sign-in is only reachable through our server action (no /api/auth HTTP route), which applies
    // cross-clinic limits in the database (src/lib/security/global-limit.ts).
    rateLimit: { enabled: false },
    plugins: [
      // Two-step verification with an authenticator app (+ 10 backup codes), both stored encrypted.
      // Wrong codes: 5 tries per sign-in, then the account's second step locks for 15 minutes.
      twoFactor({ issuer: "Clinic Platform" }),
      nextCookies(), // must stay last
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __auth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__auth ??= createAuth();
  return globalForAuth.__auth;
}
