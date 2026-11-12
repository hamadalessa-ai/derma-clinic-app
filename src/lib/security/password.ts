import "server-only";
/**
 * Password rules for staff (set from the invitation link): at least 10 characters (checked by the
 * form), not a well-known password, not built from the person's own name or email, and not found in
 * known data breaches (Have I Been Pwned, "k-anonymity": only the first 5 characters of the
 * password's SHA-1 hash leave our server — never the password). If that service can't be reached
 * within 3 seconds, the other rules still apply.
 */
import { createHash } from "node:crypto";

export type PasswordProblem = "too_common" | "contains_name" | "breached";

const COMMON = new Set([
  "1234567890",
  "12345678910",
  "0123456789",
  "1122334455",
  "1111111111",
  "0000000000",
  "qwertyuiop",
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "iloveyou123",
  "abcdefghij",
  "abc1234567",
  "welcome123",
  "admin12345",
  "letmein123",
  "qwerty1234",
  "1q2w3e4r5t",
  "clinic1234",
  "doctor1234",
  "riyadh1234",
  "saudi12345",
  "ksa1234567",
]);

function localProblem(password: string, personal: string[]): PasswordProblem | null {
  const p = password.toLowerCase();
  if (COMMON.has(p) || /^(.)\1+$/.test(p) || /^(?:0123456789|1234567890|9876543210)+$/.test(p)) {
    return "too_common";
  }
  for (const word of personal) {
    const w = word.toLowerCase().trim();
    if (w.length >= 4 && p.includes(w)) return "contains_name";
  }
  return null;
}

async function breached(password: string, timeoutMs = 3000): Promise<boolean> {
  if (process.env.NODE_ENV === "test" || process.env.PASSWORD_BREACH_CHECK === "off") return false;
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const suffix = hash.slice(5);
    return (await res.text())
      .split("\n")
      .some((line) => {
        const [s, n] = line.trim().split(":");
        return s === suffix && Number(n) > 0;
      });
  } catch {
    return false;
  }
}

/** What's wrong with this password, or null. `personal`: the person's email and names. */
export async function passwordProblem(
  password: string,
  personal: (string | null | undefined)[],
): Promise<PasswordProblem | null> {
  const words = personal
    .filter((x): x is string => Boolean(x))
    .flatMap((x) => [x, ...x.split(/[@.\s_-]+/)]);
  return localProblem(password, words) ?? ((await breached(password)) ? "breached" : null);
}

export const __test = { localProblem };
