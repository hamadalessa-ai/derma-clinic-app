"use client";

import "./globals.css";

/**
 * Last resort when even the page frame fails: plain, bilingual (no translations or fonts can
 * be relied on here), with one button to try again.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-background text-foreground">
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-2xl font-bold">حدث خطأ غير متوقع</h1>
          <p className="text-muted-foreground" dir="ltr">
            Something went wrong. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="bg-primary text-primary-foreground rounded-lg px-4 py-2 font-medium"
          >
            حاول مرة أخرى · Try again
          </button>
          {error.digest && (
            <p className="text-muted-foreground text-xs" dir="ltr">
              Ref: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
