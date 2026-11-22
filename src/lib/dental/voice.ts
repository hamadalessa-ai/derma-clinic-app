/**
 * Dental voice charting (pure, shared by server and browser): what the dentist said — or typed —
 * read by fixed rules into chart entries. No AI, nothing leaves the clinic's browser and server.
 *
 * "16 MO caries, 26 crown, 36 missing"   → finding AFTER the teeth
 * "caries 16 17, crown 26"               → finding BEFORE the teeth
 * "١٦ تسوس، ٢٦ تاج، ٣٦ مفقود"             → Arabic words and digits
 *
 * Which order is used is decided by what comes first: a tooth number or a finding. Surfaces
 * (M O D B L, or their names) go with the teeth they are said with. The dentist always sees
 * the result and saves it with one tap; nothing is recorded from here directly.
 */
import { isTooth, normalizeSurfaces, type ToothCondition } from "./teeth";

export interface DictatedTooth {
  tooth: number;
  condition: ToothCondition;
  surfaces: string;
}

export interface Dictation {
  items: DictatedTooth[];
  /** Tooth numbers said without any finding. */
  withoutFinding: number[];
}

/** Latin digits, one form of each Arabic letter, no diacritics (case kept: "DO" ≠ "do"). */
function normalize(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

/** Phrases first (longest match wins), then single words. Arabic in normalized spelling. */
const CONDITION_WORDS: [string, ToothCondition][] = [
  ["root canal", "root_canal"],
  ["root canal treatment", "root_canal"],
  ["علاج عصب", "root_canal"],
  ["سحب عصب", "root_canal"],
  ["to extract", "extraction_needed"],
  ["needs extraction", "extraction_needed"],
  ["غير موجود", "missing"],
  ["rct", "root_canal"],
  ["endo", "root_canal"],
  ["عصب", "root_canal"],
  ["caries", "caries"],
  ["carious", "caries"],
  ["cavity", "caries"],
  ["cavities", "caries"],
  ["decay", "caries"],
  ["decayed", "caries"],
  ["تسوس", "caries"],
  ["مسوس", "caries"],
  ["نخر", "caries"],
  ["filling", "filled"],
  ["filled", "filled"],
  ["restoration", "filled"],
  ["restored", "filled"],
  ["composite", "filled"],
  ["amalgam", "filled"],
  ["حشوه", "filled"],
  ["محشو", "filled"],
  ["crown", "crown"],
  ["crowned", "crown"],
  ["تاج", "crown"],
  ["تلبيسه", "crown"],
  ["missing", "missing"],
  ["absent", "missing"],
  ["مفقود", "missing"],
  ["مخلوع", "missing"],
  ["implant", "implant"],
  ["زرعه", "implant"],
  ["زراعه", "implant"],
  ["bridge", "bridge"],
  ["جسر", "bridge"],
  ["extract", "extraction_needed"],
  ["extraction", "extraction_needed"],
  ["خلع", "extraction_needed"],
  ["watch", "watch"],
  ["monitor", "watch"],
  ["مراقبه", "watch"],
  ["متابعه", "watch"],
  ["healthy", "healthy"],
  ["sound", "healthy"],
  ["سليم", "healthy"],
];

const SURFACE_WORDS: Record<string, string> = {
  mesial: "M",
  occlusal: "O",
  distal: "D",
  buccal: "B",
  labial: "B",
  facial: "B",
  lingual: "L",
  palatal: "L",
  انسي: "M",
  اطباقي: "O",
  وحشي: "D",
  خدي: "B",
  دهليزي: "B",
  شفوي: "B",
  لساني: "L",
  حنكي: "L",
};

/** English words made only of surface letters. */
const NOT_SURFACES = new Set(["do", "old", "bold", "mold", "mob"]);

/** Arabic words may carry "و" (and), "ال" (the), "ب" (with) in front. */
function arabicStems(word: string): string[] {
  const out = [word];
  for (const p of ["وال", "بال", "ال", "و", "ب"]) {
    if (word.startsWith(p) && word.length > p.length + 1) out.push(word.slice(p.length));
  }
  return out;
}

type Token =
  | { kind: "tooth"; n: number }
  | { kind: "condition"; c: ToothCondition }
  | { kind: "surfaces"; s: string };

function tokenize(text: string): Token[] {
  const raw = normalize(text)
    .split(/[\s,،.;؛:/\-–—()]+/)
    .filter(Boolean);
  const words = raw.map((w) => w.toLowerCase());
  const out: Token[] = [];
  for (let i = 0; i < words.length; i++) {
    // Phrases of up to three words, longest first.
    let matched = false;
    for (const len of [3, 2]) {
      const phrase = words.slice(i, i + len).join(" ");
      const hit = CONDITION_WORDS.find(([w]) => w === phrase);
      if (words.length - i >= len && hit) {
        out.push({ kind: "condition", c: hit[1] });
        i += len - 1;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const w = words[i];
    // Tooth numbers, also "tooth16" / "سن16" written together.
    const num = w.match(/^(?:\D*?)([1-4][1-8])$/);
    if (num && isTooth(Number(num[1]))) {
      out.push({ kind: "tooth", n: Number(num[1]) });
      continue;
    }
    const stems = arabicStems(w);
    const cond = CONDITION_WORDS.find(([k]) => stems.includes(k));
    if (cond) {
      out.push({ kind: "condition", c: cond[1] });
      continue;
    }
    const surfaceWord = stems.map((s) => SURFACE_WORDS[s]).find(Boolean);
    if (surfaceWord) {
      out.push({ kind: "surfaces", s: surfaceWord });
      continue;
    }
    // Surface letters said together: "MO", "MOD", "DOL" … English words made of the same letters
    // ("do", "old") count only in capitals ("DO").
    const capitals = raw[i] === raw[i].toUpperCase();
    if (
      /^[modbl]{1,5}$/.test(w) &&
      (capitals || !NOT_SURFACES.has(w)) &&
      new Set(w).size === w.length
    ) {
      out.push({ kind: "surfaces", s: w });
    }
  }
  return out;
}

/** Reads the dictation. The same tooth said twice: the last finding counts. */
export function parseDictation(text: string): Dictation {
  const tokens = tokenize(text);
  const firstTooth = tokens.findIndex((t) => t.kind === "tooth");
  const firstCondition = tokens.findIndex((t) => t.kind === "condition");
  const findingFirst = firstCondition >= 0 && (firstTooth < 0 || firstCondition < firstTooth);

  const found = new Map<number, DictatedTooth>();
  const withoutFinding: number[] = [];
  let teeth: number[] = [];
  let surfaces = "";
  let leading: ToothCondition | null = null;
  /** The teeth just given a finding ("16 filled MOD": the surfaces come after the finding). */
  let last: number[] = [];

  const assign = (c: ToothCondition) => {
    for (const n of teeth) {
      found.delete(n);
      found.set(n, { tooth: n, condition: c, surfaces: normalizeSurfaces(surfaces) });
    }
    last = teeth;
    teeth = [];
    surfaces = "";
  };

  for (const t of tokens) {
    if (t.kind === "tooth") {
      last = [];
      if (!teeth.includes(t.n)) teeth.push(t.n);
    } else if (t.kind === "surfaces") {
      if (!findingFirst && !teeth.length && last.length) {
        for (const n of last) {
          const item = found.get(n);
          if (item) item.surfaces = normalizeSurfaces(item.surfaces + t.s);
        }
      } else {
        surfaces += t.s;
      }
    } else if (findingFirst) {
      if (leading) assign(leading);
      else teeth = [];
      leading = t.c;
    } else if (teeth.length) {
      assign(t.c);
    }
  }
  if (findingFirst && leading) assign(leading);
  for (const n of teeth) if (!found.has(n) && !withoutFinding.includes(n)) withoutFinding.push(n);

  return {
    // Healthy and missing teeth have no surfaces.
    items: [...found.values()].map((x) =>
      x.condition === "healthy" || x.condition === "missing" ? { ...x, surfaces: "" } : x,
    ),
    withoutFinding: withoutFinding.filter((n) => !found.has(n)),
  };
}
