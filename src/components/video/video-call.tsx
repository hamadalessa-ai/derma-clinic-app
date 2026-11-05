"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PhoneOff, Video } from "lucide-react";
import { joinVideoAction } from "@/app/actions/clinic";
import { joinVideoAsPatientAction } from "@/app/actions/patient";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/clinic/form-message";
import { useAction } from "@/components/clinic/use-action";

/**
 * The video call, shown inside our own page (the video service's ready-made call screen).
 * The personal join link is fetched only when the person taps "Join", so reloading the page
 * never starts a call by itself; the call keeps running while the doctor writes the note.
 */
export function VideoCall(
  props: { as: "doctor"; appointmentId: string } | { as: "patient"; token: string },
) {
  const t = useTranslations("video");
  const [url, setUrl] = useState<string | null>(null);
  const { run, pending, error } = useAction();

  function join() {
    run(
      () =>
        props.as === "doctor"
          ? joinVideoAction({ appointmentId: props.appointmentId })
          : joinVideoAsPatientAction({ token: props.token }),
      (r) => setUrl(r.url),
    );
  }

  if (!url) {
    return (
      <div className="flex flex-col gap-3" data-testid="video-join">
        <Button size="lg" className="self-start" loading={pending} onClick={join}>
          {!pending && <Video />}
          {pending ? t("joining") : t("join")}
        </Button>
        <p className="text-muted-foreground text-xs">{t("permissionsHint")}</p>
        <FormError message={error} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="video-call">
      <iframe
        src={url}
        title={t("callTitle")}
        allow="camera; microphone; fullscreen; display-capture; autoplay; speaker-selection"
        className="bg-muted h-[70dvh] min-h-80 w-full rounded-md border"
      />
      <Button variant="outline" className="self-start" onClick={() => setUrl(null)}>
        <PhoneOff />
        {t("leave")}
      </Button>
    </div>
  );
}
