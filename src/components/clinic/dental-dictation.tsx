"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Mic, Square } from "lucide-react";
import { recordTeethAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { parseDictation } from "@/lib/dental/voice";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

/** The browser's speech recognition (Chrome: SpeechRecognition / webkit…, Safari: webkit…). */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};

/**
 * Voice charting under the dental chart: the dentist says (or types) "16 MO caries, 26 crown",
 * sees the teeth it understood, unticks any mistake and saves them all with one tap. Speech
 * becomes text in the browser; the text is read by fixed rules (`parseDictation`), never by AI.
 */
export function DentalDictation({
  patientId,
  appointmentId,
}: {
  patientId: string;
  appointmentId: string | null;
}) {
  const t = useTranslations("dental");
  const toast = useToast();
  const canDictate = useSyncExternalStore(
    noSubscribe,
    () => !!recognitionCtor(),
    () => true,
  );
  const [lang, setLang] = useState<"ar-SA" | "en-US">("ar-SA");
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const rec = useRef<Recognition | null>(null);
  const wantOn = useRef(false);
  const act = useAction();

  const parsed = useMemo(() => parseDictation(text), [text]);
  const chosen = parsed.items.filter((i) => !skipped.has(i.tooth));

  useEffect(() => {
    return () => {
      wantOn.current = false;
      rec.current?.stop();
    };
  }, []);

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return setMicError(t("voiceNoMic"));
    setMicError(null);
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let finals = "";
      let pendingText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals += res[0].transcript;
        else pendingText += res[0].transcript;
      }
      // Each pause starts a new finding: a comma keeps "16 caries" and "26 crown" apart.
      if (finals)
        setText((old) => (old.trim() ? `${old.trim()}، ${finals.trim()}` : finals.trim()));
      setInterim(pendingText);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantOn.current = false;
        setMicError(t("voiceMicBlocked"));
      }
    };
    // Browsers stop after a pause: keep listening until Stop.
    r.onend = () => {
      setInterim("");
      if (wantOn.current) {
        try {
          r.start();
        } catch {
          wantOn.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };
    rec.current = r;
    wantOn.current = true;
    setListening(true);
    r.start();
  }

  function stop() {
    wantOn.current = false;
    rec.current?.stop();
    setListening(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3" data-testid="dental-dictation">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 font-medium">
          <Mic className="text-brand-strong size-4" />
          {t("voiceTitle")}
        </span>
        <p className="text-muted-foreground text-xs">{t("voiceHint")}</p>
      </div>

      {canDictate && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`dictation-lang-${patientId}`}>{t("voiceLanguage")}</Label>
            <Select
              id={`dictation-lang-${patientId}`}
              value={lang}
              disabled={listening}
              onChange={(e) => setLang(e.target.value === "en-US" ? "en-US" : "ar-SA")}
              className="h-9 w-auto"
            >
              <option value="ar-SA">العربية</option>
              <option value="en-US">English</option>
            </Select>
          </div>
          {listening ? (
            <Button type="button" variant="outline" onClick={stop} data-testid="dictation-stop">
              <Square />
              {t("voiceStop")}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={start} data-testid="dictation-start">
              <Mic />
              {t("voiceStart")}
            </Button>
          )}
        </div>
      )}
      {micError && <p className="text-warning-foreground text-sm">{micError}</p>}

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSkipped(new Set());
        }}
        placeholder={t("voicePlaceholder")}
        className="min-h-16"
        aria-label={t("voiceTitle")}
        data-testid="dictation-text"
      />
      {interim && <p className="text-muted-foreground text-sm italic">{interim}</p>}

      {text.trim() &&
        (parsed.items.length ? (
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="dictation-items">
            {parsed.items.map((i) => (
              <li key={i.tooth}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-brand size-4"
                    checked={!skipped.has(i.tooth)}
                    onChange={() =>
                      setSkipped((s) => {
                        const next = new Set(s);
                        if (next.has(i.tooth)) next.delete(i.tooth);
                        else next.add(i.tooth);
                        return next;
                      })
                    }
                    data-testid="dictation-item"
                    data-tooth={i.tooth}
                    data-condition={i.condition}
                  />
                  <span className="font-mono font-semibold" dir="ltr">
                    {i.tooth}
                  </span>
                  <span>{t(`cond.${i.condition}`)}</span>
                  {i.surfaces && (
                    <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                      {i.surfaces}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("voiceNone")}</p>
        ))}
      {parsed.withoutFinding.length > 0 && (
        <p className="text-warning-foreground text-sm" data-testid="dictation-no-finding">
          {t("voiceNoFinding", { teeth: parsed.withoutFinding.join(", ") })}
        </p>
      )}

      <FormError message={act.error} />
      {chosen.length > 0 && (
        <Button
          type="button"
          className="self-start"
          loading={act.pending}
          data-testid="dictation-save"
          onClick={() =>
            act.run(
              () =>
                recordTeethAction({
                  patientId,
                  appointmentId,
                  items: chosen.map(({ tooth, condition, surfaces }) => ({
                    tooth,
                    condition,
                    surfaces,
                  })),
                }),
              () => {
                if (listening) stop();
                setText("");
                setSkipped(new Set());
                toast(t("voiceSaved"));
              },
            )
          }
        >
          {t("voiceSave", { n: chosen.length })}
        </Button>
      )}
    </div>
  );
}
