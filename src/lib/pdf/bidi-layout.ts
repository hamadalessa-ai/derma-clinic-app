/**
 * Arabic/English text layout for PDFs.
 *
 * PDF libraries draw text left-to-right. For Arabic mixed with English, numbers, dates and
 * punctuation we do what a browser does:
 *   1. break the paragraph into lines using real glyph widths from the font (fontkit),
 *   2. order each line with the Unicode Bidirectional Algorithm (UAX #9, via bidi-js),
 *   3. cut the line into "atoms" that each have ONE direction and ONE script.
 * The PDF renderer then only ever draws simple atoms: Arabic words (it joins the letters
 * correctly), English/number runs, or single punctuation marks (mirrored when needed).
 */
import bidiFactory from "bidi-js";
import type { Font } from "fontkit";

const bidi = bidiFactory();

export interface Atom {
  /** Text to draw, in LOGICAL order (the renderer shapes Arabic itself). */
  text: string;
  /** Unicode bidi level: odd = right-to-left. */
  level: number;
  /** True for a run of spaces (drawn as a gap). */
  space: boolean;
}

export interface Line {
  /** Atoms in VISUAL order, left to right. */
  atoms: Atom[];
  width: number;
}

const ARABIC_LETTER = /[؀-؅؈؋؍ؐ-ؚ؜-يً-ٟٮ-ۓە-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const SPACE = /\s/;

type CharClass = "arabic" | "space" | "other";
function classOf(ch: string): CharClass {
  if (SPACE.test(ch)) return "space";
  if (ARABIC_LETTER.test(ch)) return "arabic";
  return "other";
}

export interface Measurer {
  width(text: string): number;
}

/** Text width in points for a fontkit font at a size (includes Arabic shaping). */
export function fontMeasurer(font: Font, size: number): Measurer {
  const scale = size / font.unitsPerEm;
  const cache = new Map<string, number>();
  return {
    width(text) {
      let w = cache.get(text);
      if (w === undefined) {
        w = font.layout(text).advanceWidth * scale;
        cache.set(text, w);
      }
      return w;
    },
  };
}

/** Greedy line breaking on spaces, in logical order. Very long words get their own line. */
export function breakLines(paragraph: string, maxWidth: number, m: Measurer): string[] {
  const words = paragraph.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && m.width(candidate) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Orders one line visually (UAX #9 rules L1–L4) and cuts it into single-direction atoms.
 * `base` is the paragraph direction: "rtl" for Arabic text, "ltr" for English text.
 */
export function visualAtoms(line: string, base: "rtl" | "ltr" = "rtl"): Atom[] {
  if (!line) return [];
  const embedding = bidi.getEmbeddingLevels(line, base);
  const levels = embedding.levels;
  const mirrored = bidi.getMirroredCharactersMap(line, levels);

  // Visual order of character indices.
  const order = Array.from({ length: line.length }, (_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(line, embedding)) {
    const slice = order.slice(start, end + 1).reverse();
    order.splice(start, slice.length, ...slice);
  }

  // Group consecutive visual characters into atoms of one level and one class,
  // that are also contiguous in logical order (so Arabic words stay whole).
  const atoms: Atom[] = [];
  let group: number[] = [];
  const flush = () => {
    if (!group.length) return;
    const level = levels[group[0]];
    const rtl = level % 2 === 1;
    const logical = rtl ? [...group].reverse() : group;
    const text = logical.map((i) => mirrored.get(i) ?? line[i]).join("");
    atoms.push({ text, level, space: classOf(line[group[0]]) === "space" });
    group = [];
  };
  for (const idx of order) {
    if (group.length) {
      const prev = group[group.length - 1];
      const sameLevel = levels[idx] === levels[prev];
      const cls = classOf(line[idx]);
      const sameClass = cls === classOf(line[prev]);
      const rtl = levels[idx] % 2 === 1;
      const contiguous = rtl ? idx === prev - 1 : idx === prev + 1;
      // In right-to-left runs, punctuation is drawn one mark at a time (safe for mirroring).
      const splitNeutral = rtl && cls === "other";
      if (!(sameLevel && sameClass && contiguous) || splitNeutral) flush();
    }
    group.push(idx);
  }
  flush();
  return atoms;
}

/** Full layout: lines of visually ordered atoms with their widths. */
export function layoutParagraph(
  paragraph: string,
  maxWidth: number,
  m: Measurer,
  base: "rtl" | "ltr" = "rtl",
): Line[] {
  return breakLines(paragraph, maxWidth, m).map((text) => {
    const atoms = visualAtoms(text, base);
    return { atoms, width: atoms.reduce((s, a) => s + m.width(a.text), 0) };
  });
}

/**
 * Visual (left-to-right) order of the line's characters, by logical index, spaces left out.
 * Used by the browser comparison test: Chromium must place characters in the same order.
 */
export function visualOrder(line: string, base: "rtl" | "ltr" = "rtl"): number[] {
  const embedding = bidi.getEmbeddingLevels(line, base);
  const order = Array.from({ length: line.length }, (_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(line, embedding)) {
    const slice = order.slice(start, end + 1).reverse();
    order.splice(start, slice.length, ...slice);
  }
  return order.filter((i) => !SPACE.test(line[i]));
}
