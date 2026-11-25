"use client";

import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { startVisitAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

/** "Start visit": marks the patient "with the doctor" and opens the visit screen with its note. */
export function StartVisitButton({
  appointmentId,
  label,
  size = "default",
  variant = "default",
  navigate = false,
}: {
  appointmentId: string;
  label: string;
  size?: "default" | "sm" | "lg";
  /** "outline" when another card on the screen holds the main action. */
  variant?: "default" | "outline";
  /** From My Day: go to the visit screen afterwards. */
  navigate?: boolean;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  return (
    <>
      <Button
        size={size}
        variant={variant}
        loading={pending}
        data-testid="start-visit"
        onClick={() =>
          run(
            () => startVisitAction({ appointmentId }),
            () => {
              if (navigate) router.push(`/visits/${appointmentId}`);
            },
          )
        }
      >
        {!pending && <Play />}
        {label}
      </Button>
      <FormError message={error} />
    </>
  );
}
