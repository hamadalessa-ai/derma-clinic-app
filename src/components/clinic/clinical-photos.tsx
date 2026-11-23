"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Camera, Columns2, EyeOff, ImagePlus } from "lucide-react";
import { voidPhotoAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { Locale } from "@/i18n/config";
import { pick } from "@/lib/brand";
import { PHOTO_AREAS, PHOTO_VIEWS } from "@/lib/photos/areas";
import type { PhotoItem } from "@/lib/photos/photos";
import { cn } from "@/lib/utils";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

type Areas = { area: PhotoItem["area"]; photos: PhotoItem[] }[];

const src = (p: PhotoItem) => `/api/files/${p.fileId}`;

/**
 * Before / after photos for one patient: grouped by area, oldest first; tap two photos of the same
 * area to compare them side by side. Doctors and nurses add photos (camera on a phone or tablet,
 * or a saved picture) and hide a wrong one with a reason. On the visit screen (`compact`) new
 * photos belong to that visit and only the latest few are shown.
 */
export function ClinicalPhotos({
  patientId,
  appointmentId,
  data,
  canManage,
  compact,
}: {
  patientId: string;
  appointmentId: string | null;
  data: { total: number; areas: Areas };
  canManage: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("photos");
  const locale = useLocale() as Locale;
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<PhotoItem[]>([]);
  const [comparing, setComparing] = useState(false);
  const [hiding, setHiding] = useState<PhotoItem | null>(null);

  const toggle = (p: PhotoItem) => {
    setPicked((cur) => {
      if (cur.some((x) => x.id === p.id)) return cur.filter((x) => x.id !== p.id);
      // Only photos of the same area are compared: a new area starts a new pair.
      const same = cur.filter((x) => x.area === p.area);
      const next = [...same, p].slice(-2);
      if (next.length === 2) setComparing(true);
      return next;
    });
  };
  const pair = [...picked].sort((a, b) => a.takenOn.localeCompare(b.takenOn));
  const areas = compact
    ? data.areas.map((a) => ({ ...a, photos: a.photos.slice(-4) }))
    : data.areas;

  return (
    <Card data-testid="clinical-photos">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          {!compact && <p className="text-muted-foreground text-xs">{t("hint")}</p>}
        </div>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            data-testid="photo-add"
          >
            <Camera />
            {compact ? t("take") : t("add")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {data.total === 0 ? (
          compact ? (
            <p className="text-muted-foreground text-sm">{t("none")}</p>
          ) : (
            <EmptyState icon={<ImagePlus />} title={t("none")} />
          )
        ) : (
          <>
            {!compact && data.areas.some((a) => a.photos.length > 1) && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Columns2 className="size-3.5" />
                {t("compareHint")}
              </p>
            )}
            {areas.map((a) => (
              <section key={a.area} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  {t(`areas.${a.area}`)}{" "}
                  <span className="text-muted-foreground font-normal">
                    · {t("photos", { n: a.photos.length })}
                  </span>
                </h3>
                <div
                  className={cn(
                    "grid gap-2",
                    compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
                  )}
                >
                  {a.photos.map((p) => {
                    const on = picked.some((x) => x.id === p.id);
                    return (
                      <figure key={p.id} className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => toggle(p)}
                          className={cn(
                            "bg-muted relative aspect-[4/5] overflow-hidden rounded-lg border-2 transition-colors",
                            on ? "border-brand" : "border-transparent",
                          )}
                          aria-pressed={on}
                          data-testid="photo-thumb"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- private, audited file route */}
                          <img
                            src={src(p)}
                            alt={`${t(`areas.${p.area}`)} · ${t(`views.${p.view}`)} · ${p.takenOn}`}
                            className="size-full object-cover"
                            loading="lazy"
                          />
                          {appointmentId && p.appointmentId === appointmentId && (
                            <span className="bg-card/90 absolute start-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium">
                              {t("thisVisit")}
                            </span>
                          )}
                        </button>
                        <figcaption className="text-muted-foreground flex items-center justify-between gap-1 text-xs">
                          <span>
                            <span dir="ltr">{p.takenOn}</span> · {t(`views.${p.view}`)}
                          </span>
                          {canManage && !compact && (
                            <button
                              type="button"
                              className="hover:text-foreground p-1"
                              title={t("void")}
                              aria-label={t("void")}
                              onClick={() => setHiding(p)}
                            >
                              <EyeOff className="size-3.5" />
                            </button>
                          )}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </CardContent>

      <Dialog
        open={comparing && pair.length === 2}
        onClose={() => {
          setComparing(false);
          setPicked([]);
        }}
        title={pair[0] ? `${t("compare")} · ${t(`areas.${pair[0].area}`)}` : t("compare")}
        closeLabel={t("closeCompare")}
        className="sm:w-[min(100vw-2rem,56rem)]"
      >
        <div className="grid grid-cols-2 gap-3" data-testid="photo-compare">
          {pair.map((p, i) => (
            <figure key={p.id} className="flex flex-col gap-1.5">
              <div className="bg-muted aspect-[4/5] overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, audited file route */}
                <img src={src(p)} alt="" className="size-full object-cover" />
              </div>
              <figcaption className="text-sm">
                <span className="font-semibold">{i === 0 ? t("before") : t("after")}</span>
                {" · "}
                <span dir="ltr">{p.takenOn}</span> · {t(`views.${p.view}`)}
                {p.takenBy && (
                  <span className="text-muted-foreground block text-xs">
                    {t("takenBy", { name: pick(locale, p.takenBy, p.takenByEn) })}
                  </span>
                )}
                {p.note && <span className="text-muted-foreground block text-xs">{p.note}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      </Dialog>

      {canManage && (
        <AddPhotoDialog
          open={adding}
          onClose={() => setAdding(false)}
          patientId={patientId}
          appointmentId={appointmentId}
        />
      )}
      {canManage && (
        <HidePhotoDialog photo={hiding} onClose={() => setHiding(null)} patientId={patientId} />
      )}
    </Card>
  );
}

function AddPhotoDialog({
  open,
  onClose,
  patientId,
  appointmentId,
}: {
  open: boolean;
  onClose: () => void;
  patientId: string;
  appointmentId: string | null;
}) {
  const t = useTranslations("photos");
  const te = useTranslations("errors");
  const router = useRouter();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [area, setArea] = useState<string>("face");
  const [view, setView] = useState<string>("front");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const body = new FormData();
        body.set("file", file);
        body.set("patientId", patientId);
        if (appointmentId) body.set("appointmentId", appointmentId);
        body.set("area", area);
        body.set("view", view);
        if (note.trim()) body.set("note", note.trim());
        const res = await fetch("/api/photos/upload", { method: "POST", body }).catch(() => null);
        if (!res?.ok) {
          const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
          setError(code?.startsWith("photos_") ? te(code) : t("uploadFailed"));
          return;
        }
      }
      toast(t("saved"));
      setFiles([]);
      setNote("");
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("add")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (files.length) void save();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="photo-file">{t("take")}</Label>
          <Input
            id="photo-file"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            data-testid="photo-file"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="photo-area">{t("area")}</Label>
            <Select id="photo-area" value={area} onChange={(e) => setArea(e.target.value)}>
              {PHOTO_AREAS.map((a) => (
                <option key={a} value={a}>
                  {t(`areas.${a}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="photo-view">{t("view")}</Label>
            <Select id="photo-view" value={view} onChange={(e) => setView(e.target.value)}>
              {PHOTO_VIEWS.map((v) => (
                <option key={v} value={v}>
                  {t(`views.${v}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="photo-note">{t("note")}</Label>
          <Input
            id="photo-note"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <Button
          type="submit"
          className="self-start"
          disabled={!files.length}
          loading={busy}
          data-testid="photo-save"
        >
          {busy ? t("uploading") : t("save")}
        </Button>
      </form>
    </Dialog>
  );
}

function HidePhotoDialog({
  photo,
  onClose,
  patientId,
}: {
  photo: PhotoItem | null;
  onClose: () => void;
  patientId: string;
}) {
  const t = useTranslations("photos");
  const toast = useToast();
  const [reason, setReason] = useState("");
  const act = useAction();
  return (
    <Dialog open={!!photo} onClose={onClose} title={t("void")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!photo) return;
          act.run(
            () => voidPhotoAction({ patientId, photoId: photo.id, reason }),
            () => {
              toast(t("voided"));
              setReason("");
              onClose();
            },
          );
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="photo-void-reason">{t("voidReason")}</Label>
          <Input
            id="photo-void-reason"
            required
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <FormError message={act.error} />
        <Button type="submit" variant="destructive" className="self-start" loading={act.pending}>
          {t("voidConfirm")}
        </Button>
      </form>
    </Dialog>
  );
}
