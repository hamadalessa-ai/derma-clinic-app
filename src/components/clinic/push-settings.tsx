"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Send, Share } from "lucide-react";
import {
  removePushSubscriptionAction,
  saveNotificationPrefsAction,
  savePushSubscriptionAction,
  testPushAction,
} from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { PushType } from "@/lib/push/payload";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

/** VAPID public key (base64url) → bytes for PushManager.subscribe. */
function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type DeviceState = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on";

export function PushDeviceSettings({
  publicKey,
  devices,
}: {
  publicKey: string | null;
  devices: number;
}) {
  const t = useTranslations("account");
  const te = useTranslations("errors");
  const router = useRouter();
  const [state, setState] = useState<DeviceState>("checking");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    (async () => {
      if (ios && !standalone) return setState("ios-install");
      if (!supported) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const turnOn = () =>
    start(async () => {
      setError(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return setState("denied");
        const reg =
          (await navigator.serviceWorker.getRegistration()) ??
          (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey!),
        });
        const json = sub.toJSON();
        const r = await savePushSubscriptionAction({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          userAgent: navigator.userAgent,
        });
        if (!r.ok) return setError(te.has(r.error) ? te(r.error) : te("unexpected"));
        setState("on");
        router.refresh();
      } catch {
        setError(te("unexpected"));
      }
    });

  const turnOff = () =>
    start(async () => {
      setError(null);
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction({ endpoint: sub.endpoint });
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
      router.refresh();
    });

  const test = () =>
    start(async () => {
      setMsg(null);
      const r = await testPushAction();
      if (!r.ok) return setError(te.has(r.error) ? te(r.error) : te("unexpected"));
      setMsg(r.data.devices ? t("testSent", { count: r.data.sent }) : t("testNone"));
    });

  return (
    <div className="flex flex-col gap-3" data-testid="push-device" data-state={state}>
      <p className="text-muted-foreground text-sm">{t("pushHint")}</p>
      {!publicKey && <Notice tone="warning">{t("notConfigured")}</Notice>}
      {state === "unsupported" && <Notice tone="warning">{t("notSupported")}</Notice>}
      {state === "denied" && <Notice tone="warning">{t("denied")}</Notice>}
      {state === "ios-install" && (
        <div
          className="bg-info text-info-foreground flex flex-col gap-2 rounded-md p-3 text-sm"
          data-testid="ios-guide"
        >
          <div className="flex items-center gap-2 font-semibold">
            <Share className="size-4" />
            {t("iosTitle")}
          </div>
          <ol className="list-decimal space-y-1 ps-5">
            <li>{t("iosStep1")}</li>
            <li>{t("iosStep2")}</li>
            <li>{t("iosStep3")}</li>
            <li>{t("iosStep4")}</li>
          </ol>
        </div>
      )}
      {state === "on" && <Notice tone="success">{t("onHere")}</Notice>}
      <div className="flex flex-wrap gap-2">
        {publicKey && state === "off" && (
          <Button onClick={turnOn} disabled={pending} data-testid="push-on">
            <Bell />
            {t("turnOn")}
          </Button>
        )}
        {state === "on" && (
          <Button variant="outline" onClick={turnOff} disabled={pending} data-testid="push-off">
            <BellOff />
            {t("turnOff")}
          </Button>
        )}
        {publicKey && devices > 0 && (
          <Button variant="outline" onClick={test} disabled={pending} data-testid="push-test">
            <Send />
            {t("test")}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("devices", { count: devices })}</p>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}

export function NotificationPrefsForm({
  types,
  initial,
}: {
  types: PushType[];
  initial: { enabled: boolean; mutedTypes: PushType[] };
}) {
  const t = useTranslations("account");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [muted, setMuted] = useState(new Set<string>(initial.mutedTypes));
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const save = (nextEnabled: boolean, nextMuted: Set<string>) =>
    run(
      () => saveNotificationPrefsAction({ enabled: nextEnabled, mutedTypes: [...nextMuted] }),
      () => setMsg(t("saved")),
    );
  return (
    <div className="flex flex-col gap-3" data-testid="push-prefs">
      <label className="flex items-center gap-3 font-medium">
        <input
          type="checkbox"
          className="accent-brand size-5"
          checked={enabled}
          disabled={pending}
          data-testid="push-enabled"
          onChange={(e) => {
            setEnabled(e.target.checked);
            save(e.target.checked, muted);
          }}
        />
        {t("allOn")}
      </label>
      <ul className="flex flex-col gap-2 ps-8">
        {types.map((type) => (
          <li key={type}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-brand size-4"
                checked={!muted.has(type)}
                disabled={pending || !enabled}
                data-push-type={type}
                onChange={(e) => {
                  const next = new Set(muted);
                  if (e.target.checked) next.delete(type);
                  else next.add(type);
                  setMuted(next);
                  save(enabled, next);
                }}
              />
              {t(`types.${type}`)}
            </label>
          </li>
        ))}
      </ul>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}
