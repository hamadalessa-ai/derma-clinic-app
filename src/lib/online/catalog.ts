import "server-only";
import { and, asc, eq } from "drizzle-orm";
import {
  branchHolidays,
  branches,
  departments,
  rooms,
  scheduleExceptions,
  services,
  staffSchedules,
  tenantMembers,
  users,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { getSettings } from "@/lib/booking/engine";

export interface CatalogDoctor {
  id: string;
  nameAr: string;
  nameEn: string | null;
  gender: "male" | "female" | null;
  branchId: string | null; // null = all branches
}

/**
 * What the public booking page may show: branches, online services (grouped by department),
 * doctors (name, title, gender, branch — nothing else) and the clinic's online settings.
 * Prices are left out when the clinic hides them.
 */
export async function loadBookingCatalog(tx: TenantTx) {
  const settings = await getSettings(tx);
  const branchRows = await tx
    .select({ id: branches.id, nameAr: branches.nameAr, nameEn: branches.nameEn })
    .from(branches)
    .orderBy(asc(branches.sortOrder));
  const serviceRows = await tx
    .select({
      id: services.id,
      code: services.code,
      nameAr: services.nameAr,
      nameEn: services.nameEn,
      durationMinutes: services.durationMinutes,
      priceHalalas: services.priceHalalas,
      departmentId: services.departmentId,
      departmentAr: departments.nameAr,
      departmentEn: departments.nameEn,
      isVirtual: services.isVirtual,
    })
    .from(services)
    .innerJoin(departments, eq(departments.id, services.departmentId))
    .where(and(eq(services.onlineBookable, true), eq(services.isActive, true)))
    .orderBy(asc(departments.sortOrder), asc(services.sortOrder));
  const doctorRows = await tx
    .select({
      id: tenantMembers.id,
      roles: tenantMembers.roles,
      nameAr: users.name,
      nameEn: users.nameEn,
      gender: tenantMembers.gender,
      branchId: tenantMembers.branchId,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .orderBy(asc(tenantMembers.createdAt));

  // Which weekdays each branch has a doctor working, and holidays — closed days are greyed out.
  const schedules = await tx
    .select({
      branchId: staffSchedules.branchId,
      weekday: staffSchedules.weekday,
      memberId: staffSchedules.memberId,
    })
    .from(staffSchedules);
  const doctorIds = new Set(
    doctorRows.filter((d) => d.roles.includes("practitioner")).map((d) => d.id),
  );
  const openWeekdays: Record<string, number[]> = {};
  for (const s of schedules) {
    if (!doctorIds.has(s.memberId)) continue;
    const list = (openWeekdays[s.branchId] ??= []);
    if (!list.includes(s.weekday)) list.push(s.weekday);
  }
  // Branches with a video room offer video consultations.
  const videoRooms = await tx
    .select({ branchId: rooms.branchId })
    .from(rooms)
    .where(eq(rooms.isVirtual, true));
  const videoBranches = [...new Set(videoRooms.map((r) => r.branchId))];

  // One-off extra working days (e.g. a Friday clinic) open that date for booking too.
  const extra = await tx
    .select({ day: scheduleExceptions.day, branchId: scheduleExceptions.branchId })
    .from(scheduleExceptions)
    .where(eq(scheduleExceptions.kind, "hours"));

  const holidays = await tx
    .select({ day: branchHolidays.day, branchId: branchHolidays.branchId })
    .from(branchHolidays);

  const groups = new Map<
    string,
    { id: string; nameAr: string; nameEn: string; services: typeof serviceRows }
  >();
  for (const s of serviceRows) {
    const g = groups.get(s.departmentId) ?? {
      id: s.departmentId,
      nameAr: s.departmentAr,
      nameEn: s.departmentEn,
      services: [],
    };
    g.services.push(s);
    groups.set(s.departmentId, g);
  }

  return {
    enabled: settings.onlineBookingEnabled,
    settings: {
      horizonDays: settings.onlineHorizonDays,
      minNoticeMinutes: settings.onlineMinNoticeMinutes,
      cancellationWindowHours: settings.cancellationWindowHours,
      requiresApproval: settings.onlineRequiresApproval,
      showPrices: settings.showPricesOnline,
    },
    branches: branchRows,
    /** Branches whose doctors offer video consultations (patients don't pick one for video). */
    videoBranches,
    openWeekdays,
    extraDays: extra
      .filter((e) => e.branchId && doctorIds.size)
      .map((e) => ({ day: String(e.day), branchId: e.branchId! })),
    holidays: holidays.map((h) => ({ day: String(h.day), branchId: h.branchId })),
    departments: [...groups.values()].map((g) => ({
      id: g.id,
      nameAr: g.nameAr,
      nameEn: g.nameEn,
      services: g.services.map((s) => ({
        id: s.id,
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        durationMinutes: s.durationMinutes,
        isVirtual: s.isVirtual,
        priceHalalas: settings.showPricesOnline ? s.priceHalalas : null,
      })),
    })),
    doctors: doctorRows
      .filter((d) => d.roles.includes("practitioner"))
      .map((d): CatalogDoctor => ({
        id: d.id,
        nameAr: d.nameAr,
        nameEn: d.nameEn,
        gender: d.gender,
        branchId: d.branchId,
      })),
  };
}

export type BookingCatalog = Awaited<ReturnType<typeof loadBookingCatalog>>;
