"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Mic, Sparkles, Square } from "lucide-react";
import { saveDraftAction, scribeDraftAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess } from "./form-message";
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

const LANG_KEY = "scribe-lang";
type Lang = "ar-SA" | "en-US";

const noSubscribe = () => () => {};

function savedLang(): Lang {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v === "en-US" ? "en-US" : "ar-SA";
  } catch {
    return "ar-SA";
  }
}

/**
 * AI scribe inside a draft note: dictate (or type) → "Write the note" → an English draft is
 * added to the note (saved as a draft, marked "AI draft"). The doctor reviews, edits and signs.
 */
export function AiScribe({
  patientId,
  noteId,
  onDrafted,
}: {
  patientId: string;
  noteId: string;
  onDrafted: (body: string) => void;
}) {
  const t = useTranslations("scribe");
  // Read from the browser without an effect (the server assumes "supported" and Arabic).
  const canDictate = useSyncExternalStore(
    noSubscribe,
    () => !!recognitionCtor(),
    () => true,
  );
  const storedLang = useSyncExternalStore(noSubscribe, savedLang, () => "ar-SA" as Lang);
  const [failed, setFailed] = useState(false);
  const [chosenLang, setLang] = useState<Lang | null>(null);
  const supported = canDictate && !failed;
  const lang = chosenLang ?? storedLang;
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** A tidy rewrite of the whole note the doctor can choose instead (never applied silently). */
  const [tidy, setTidy] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wantOn = useRef(false);
  const { run, pending, error } = useAction();

  useEffect(() => {
    return () => {
      wantOn.current = false;
      rec.current?.stop();
    };
  }, []);

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return setFailed(true);
    setMicError(null);
    setMsg(null);
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
      if (finals) setText((old) => `${old}${old && !old.endsWith(" ") ? " " : ""}${finals.trim()}`);
      setInterim(pendingText);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantOn.current = false;
        setMicError(t("micBlocked"));
      }
    };
    // Browsers stop after a pause: keep listening until the doctor taps Stop.
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
    <div className="bg-muted flex flex-col gap-2 rounded-md border p-3" data-testid="ai-scribe">
      <div className="flex items-center gap-2 font-medium">
        <Sparkles className="text-brand size-4" />
        {t("title")}
      </div>
      <p className="text-muted-foreground text-xs">{t("hint")}</p>
      {supported ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`scribe-lang-${noteId}`}>{t("language")}</Label>
            <Select
              id={`scribe-lang-${noteId}`}
              value={lang}
              disabled={listening}
              onChange={(e) => {
                const v = e.target.value === "en-US" ? "en-US" : "ar-SA";
                setLang(v);
                try {
                  window.localStorage.setItem(LANG_KEY, v);
                } catch {
                  // remembered only when the browser allows it
                }
              }}
            >
              <option value="ar-SA">{t("arabic")}</option>
              <option value="en-US">{t("english")}</option>
            </Select>
          </div>
          {listening ? (
            <Button variant="outline" onClick={stop} data-testid="scribe-stop">
              <Square />
              {t("stop")}
            </Button>
          ) : (
            <Button variant="outline" onClick={start} disabled={pending} data-testid="scribe-start">
              <Mic />
              {t("start")}
            </Button>
          )}
          {listening && (
            <span className="text-destructive flex items-center gap-1 text-sm" aria-live="polite">
              <span className="bg-destructive size-2 animate-pulse rounded-full" />
              {t("listening")}
            </span>
          )}
        </div>
      ) : (
        <Notice tone="warning">{t("unsupported")}</Notice>
      )}
      {micError && <FormError message={micError} />}
      <Label htmlFor={`scribe-text-${noteId}`}>{t("spoken")}</Label>
      <Textarea
        id={`scribe-text-${noteId}`}
        dir="auto"
        className="min-h-24"
        value={interim ? `${text} ${interim}` : text}
        onChange={(e) => {
          setInterim("");
          setText(e.target.value);
        }}
        readOnly={listening}
        data-testid="scribe-text"
      />
      <Button
        className="self-start"
        disabled={pending || listening || text.trim().length < 5}
        onClick={() =>
          run(
            () => scribeDraftAction({ patientId, noteId, transcript: text }),
            (r) => {
              onDrafted(r.body);
              setText("");
              setTidy(r.tidy);
              setMsg(r.tidy ? null : t("done"));
            },
          )
        }
        data-testid="scribe-write"
      >
        <Sparkles />
        {pending ? t("writing") : t("write")}
      </Button>
      {tidy && (
        <Notice tone="warning" data-testid="scribe-tidy">
          <div className="flex flex-col gap-2">
            <span>{t("tidyOffer")}</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () => saveDraftAction({ patientId, noteId, body: tidy }),
                    () => {
                      onDrafted(tidy);
                      setTidy(null);
                      setMsg(t("tidyUsed"));
                    },
                  )
                }
                data-testid="scribe-use-tidy"
              >
                {t("useTidy")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTidy(null)}>
                {t("keepAll")}
              </Button>
            </div>
          </div>
        </Notice>
      )}
      <FormError message={error} />
      <FormSuccess message={msg} />
      <p className="text-muted-foreground text-xs">{t("privacy")}</p>
    </div>
  );
}
