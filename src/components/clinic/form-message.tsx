"use client";

import { useEffect } from "react";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";

/** What went wrong and how to fix it: stays next to the form until the next try. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Notice tone="danger" role="alert">
      {message}
    </Notice>
  );
}

/**
 * Confirms a finished action ("Saved", "Checked in") as a toast at the bottom of the screen.
 * `inline`: keep it on the page instead (when the message holds something to read later).
 */
export function FormSuccess({
  message,
  inline = false,
}: {
  message: string | null;
  inline?: boolean;
}) {
  const toast = useToast();
  useEffect(() => {
    if (message && !inline) toast(message);
  }, [message, inline, toast]);
  if (!message || !inline) return null;
  return (
    <Notice tone="success" role="status">
      {message}
    </Notice>
  );
}
