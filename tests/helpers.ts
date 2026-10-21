/** Runs `fn`, expects it to fail, and returns the underlying database error message. */
export async function dbError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string; code?: string } };
    return [e.cause?.message, e.cause?.code, e.message].filter(Boolean).join(" | ");
  }
  throw new Error("expected the database to refuse this, but it succeeded");
}
