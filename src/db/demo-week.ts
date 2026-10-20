/**
 * The demo week: realistic, conflict-free appointments for Derma's doctors, placed on
 * working days relative to an anchor day (setup day, or "Refresh demo week" = today).
 * ALL FAKE. dayIndex: -3 … +4 working days (Fridays skipped by public.demo_workday()).
 */
import { DERMA, DERMA_SERVICES, WORK_HOURS } from "./seed-data";

export interface DemoAppointment {
  key: string;
  dayIndex: number;
  time: string; // "HH:MM" Riyadh
  doctorKey: string;
  branchKey: string;
  patientFile: string;
  serviceCode: string;
  roomKey: string;
  deviceKey: string | null;
  status: "booked" | "confirmed" | "arrived" | "in_session" | "completed" | "no_show" | "cancelled";
  durationMinutes: number;
  bufferMinutes: number;
  note?: string;
}

export interface DemoTimeBlock {
  key: string;
  dayIndex: number;
  doctorKey: string;
  branchKey: string;
  start: string;
  end: string;
  reason: string;
}

export const DEMO_DAYS = [-3, -2, -1, 0, 1, 2, 3, 4];

export const DEMO_TIME_BLOCKS: DemoTimeBlock[] = [
  {
    key: "faisal-meeting",
    dayIndex: 0,
    doctorKey: "derma-dr-faisal",
    branchKey: "riyadh",
    start: "12:00",
    end: "13:00",
    reason: "اجتماع الطاقم الطبي",
  },
  {
    key: "majed-leave",
    dayIndex: 1,
    doctorKey: "derma-dr-majed",
    branchKey: "jeddah",
    start: "10:00",
    end: "12:00",
    reason: "إجازة صباحية",
  },
];

/** Fixed bookings that the demo story relies on. */
const FIXED: Omit<
  DemoAppointment,
  "key" | "roomKey" | "deviceKey" | "durationMinutes" | "bufferMinutes"
>[] = [
  // Today: laser patient with a 6-session package (3 used) who has NOT signed the laser consent yet.
  {
    dayIndex: 0,
    time: "17:00",
    doctorKey: "derma-dr-sara",
    branchKey: "riyadh",
    patientFile: "D-0002",
    serviceCode: "laser_hair_removal",
    status: "booked",
    note: "باقة ليزر — الجلسة 4 من 6",
  },
  // Today: patient with a lidocaine allergy (warning badge).
  {
    dayIndex: 0,
    time: "15:30",
    doctorKey: "derma-dr-sara",
    branchKey: "riyadh",
    patientFile: "D-0001",
    serviceCode: "fillers",
    status: "confirmed",
  },
  // Family: guardian's children seen in Jeddah.
  {
    dayIndex: 1,
    time: "16:00",
    doctorKey: "derma-dr-lina",
    branchKey: "jeddah",
    patientFile: "D-0039",
    serviceCode: "consultation",
    status: "confirmed",
    note: "مع وليّ الأمر",
  },
];

const ROTATION: Record<string, string[]> = {
  "derma-dr-sara": [
    "consultation",
    "botox",
    "fillers",
    "skin_boosters",
    "prp",
    "chemical_peeling",
    "morpheus8",
  ],
  "derma-dr-faisal": [
    "laser_hair_removal",
    "fractional_laser",
    "consultation",
    "laser_pigmentation",
    "vascular_laser",
    "facial_treatment",
  ],
  "derma-dr-reem": [
    "consultation",
    "ultherapy",
    "scarlet_rf",
    "mesotherapy",
    "exosomes",
    "skin_rejuvenation",
    "laser_tattoo",
  ],
  "derma-dr-lina": [
    "consultation",
    "laser_hair_removal",
    "botox",
    "facial_treatment",
    "chemical_peeling",
  ],
  "derma-dr-majed": ["consultation", "fillers", "prp", "laser_hair_removal", "skin_boosters"],
};

const POOLS: Record<string, string[]> = {
  riyadh: Array.from({ length: 19 }, (_, i) => `D-${String(i + 1).padStart(4, "0")}`),
  jeddah: Array.from({ length: 21 }, (_, i) => `D-${String(i + 20).padStart(4, "0")}`),
};

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function statusFor(dayIndex: number, order: number, n: number): DemoAppointment["status"] {
  if (dayIndex < 0) return n % 10 === 3 ? "no_show" : n % 10 === 7 ? "cancelled" : "completed";
  if (dayIndex === 0)
    return (["completed", "in_session", "arrived", "confirmed"] as const)[order] ?? "booked";
  return n % 2 === 0 ? "confirmed" : "booked";
}

export function generateDemoWeek(): DemoAppointment[] {
  const services = new Map(DERMA_SERVICES.map((s) => [s.code, s]));
  const rooms = (branch: string) =>
    DERMA.rooms.filter((r) => r.branch === branch).map((r) => r.key);
  const devices = (branch: string, type: string) =>
    DERMA.devices.filter((d) => d.branch === branch && d.deviceType === type);
  const dayStart = toMin(WORK_HOURS.start);
  const dayEnd = toMin(WORK_HOURS.end);
  const breakStart = toMin(WORK_HOURS.breakStart);
  const breakEnd = toMin(WORK_HOURS.breakEnd);

  const out: DemoAppointment[] = [];
  let n = 0;
  for (const dayIndex of DEMO_DAYS) {
    // Busy intervals per resource for this day: "kind:key" → [start, end) minutes.
    const busy = new Map<string, [number, number][]>();
    const isFree = (k: string, a: number, b: number) =>
      !(busy.get(k) ?? []).some(([s, e]) => a < e && s < b);
    const take = (k: string, a: number, b: number) => busy.set(k, [...(busy.get(k) ?? []), [a, b]]);
    for (const tb of DEMO_TIME_BLOCKS.filter((t) => t.dayIndex === dayIndex)) {
      take(`doc:${tb.doctorKey}`, toMin(tb.start), toMin(tb.end));
    }

    const place = (
      a: Omit<
        DemoAppointment,
        "key" | "roomKey" | "deviceKey" | "durationMinutes" | "bufferMinutes"
      >,
      start: number,
    ) => {
      const svc = services.get(a.serviceCode)!;
      const until = start + svc.durationMinutes + svc.bufferMinutes;
      if (start < dayStart || until > dayEnd || (start < breakEnd && breakStart < until))
        return false;
      if (!isFree(`doc:${a.doctorKey}`, start, until)) return false;
      let deviceKey: string | null = null;
      let roomChoices = rooms(a.branchKey);
      if (svc.requiredDeviceType) {
        const dev = devices(a.branchKey, svc.requiredDeviceType).find((d) =>
          isFree(`dev:${d.key}`, start, until),
        );
        if (!dev) return false;
        deviceKey = dev.key;
        roomChoices = dev.room ? [dev.room] : roomChoices;
      }
      const roomKey = roomChoices.find((r) => isFree(`room:${r}`, start, until));
      if (!roomKey) return false;
      take(`doc:${a.doctorKey}`, start, until);
      take(`room:${roomKey}`, start, until);
      if (deviceKey) take(`dev:${deviceKey}`, start, until);
      out.push({
        ...a,
        key: `${dayIndex}-${a.doctorKey}-${toTime(start)}`,
        time: toTime(start),
        roomKey,
        deviceKey,
        durationMinutes: svc.durationMinutes,
        bufferMinutes: svc.bufferMinutes,
      });
      return true;
    };

    for (const f of FIXED.filter((f) => f.dayIndex === dayIndex)) {
      if (!place(f, toMin(f.time)))
        throw new Error(`demo week: fixed booking does not fit: ${JSON.stringify(f)}`);
    }

    const doctors = DERMA.staff.filter((s) => s.roles.includes("practitioner"));
    doctors.forEach((doc, d) => {
      const pool = POOLS[doc.branch!];
      const rotation = ROTATION[doc.key];
      let cursor = dayStart + (d % 3) * 15;
      let order = 0;
      for (let tries = 0; tries < 80 && order < 6; tries++) {
        const serviceCode = rotation[(n + order + dayIndex + 8) % rotation.length];
        const ok = place(
          {
            dayIndex,
            time: "",
            doctorKey: doc.key,
            branchKey: doc.branch!,
            patientFile: pool[(n * 7 + d * 3) % pool.length],
            serviceCode,
            status: statusFor(dayIndex, order, n),
          },
          cursor,
        );
        if (ok) {
          const svc = services.get(serviceCode)!;
          cursor += svc.durationMinutes + svc.bufferMinutes + (n % 3) * 15;
          order++;
          n++;
        } else {
          cursor += 15;
        }
        if (cursor >= dayEnd) break;
      }
    });
  }
  // Keep the fixed "today" order sensible: anything later than the fixed ones stays booked/confirmed.
  return out;
}

/** A small fake signature (PNG) used for the seeded signed consents. */
export const DEMO_SIGNATURE_PNG_BASE64 =
  "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";
