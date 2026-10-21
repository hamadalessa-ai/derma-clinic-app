/** Clinic-time helpers safe for the browser (Saudi Arabia is UTC+3 all year). */
export function riyadhParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString();
  return {
    day: d.slice(0, 10),
    time: d.slice(11, 16),
    minutes: Number(d.slice(11, 13)) * 60 + Number(d.slice(14, 16)),
  };
}

export function hhmm(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function todayRiyadh() {
  return riyadhParts(new Date().toISOString()).day;
}

/** 15-minute steps between two times, e.g. for a time picker. */
export function timeOptions(start = 10 * 60, end = 20 * 60, step = 15) {
  const out: string[] = [];
  for (let m = start; m < end; m += step) out.push(hhmm(m));
  return out;
}
