import "server-only";
/**
 * Everything the clinic's public website shows, built from the clinic's own data: online services
 * (prices only when the clinic shows them online), doctors (name and title only), branches with
 * their opening days and hours, other departments ("ask on WhatsApp"), the next free consultation
 * times, and the texts from Settings → Website. Read in a clinic transaction without a user:
 * only public information leaves this function — never patients or appointments.
 */
import { asc, eq } from "drizzle-orm";
import type { SiteContent } from "@/db/schema";
import {
  branches,
  departments,
  packageTemplates,
  services,
  staffSchedules,
  tenantMembers,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { findFreeSlots, getSettings, onlineDoctors } from "@/lib/booking/engine";
import { addMinutes } from "@/lib/booking/time";
import { loadBookingCatalog } from "@/lib/online/catalog";

export interface SiteBranch {
  id: string;
  nameAr: string;
  nameEn: string;
  cityAr: string;
  cityEn: string;
  mapUrl: string | null;
  /** Weekdays with at least one doctor working (0 = Sunday). */
  days: number[];
  from: string | null;
  to: string | null;
  video: boolean;
}

export async function loadClinicSite(tenantId: string, now = new Date()) {
  return withTenant(tenantId, async (tx) => {
    const settings = await getSettings(tx);
    const catalog = await loadBookingCatalog(tx);

    const branchRows = await tx
      .select({
        id: branches.id,
        nameAr: branches.nameAr,
        nameEn: branches.nameEn,
        cityAr: branches.cityAr,
        cityEn: branches.cityEn,
        mapUrl: branches.mapUrl,
      })
      .from(branches)
      .orderBy(asc(branches.sortOrder));
    const doctorIds = new Set(catalog.doctors.map((d) => d.id));
    const schedules = (
      await tx
        .select({
          branchId: staffSchedules.branchId,
          memberId: staffSchedules.memberId,
          weekday: staffSchedules.weekday,
          start: staffSchedules.startTime,
          end: staffSchedules.endTime,
        })
        .from(staffSchedules)
    ).filter((s) => doctorIds.has(s.memberId));
    const siteBranches: SiteBranch[] = branchRows.map((b) => {
      const rows = schedules.filter((s) => s.branchId === b.id);
      return {
        ...b,
        days: [...new Set(rows.map((r) => r.weekday))].sort((x, y) => x - y),
        from: rows.map((r) => String(r.start).slice(0, 5)).sort()[0] ?? null,
        to:
          rows
            .map((r) => String(r.end).slice(0, 5))
            .sort()
            .at(-1) ?? null,
        video: catalog.videoBranches.includes(b.id),
      };
    });

    // Doctors with their titles (public: name + title only).
    const titled = await tx
      .select({
        id: tenantMembers.id,
        titleAr: tenantMembers.titleAr,
        titleEn: tenantMembers.titleEn,
        profile: tenantMembers.profile,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId));
    const titles = new Map(titled.map((m) => [m.id, m]));
    const doctors = catalog.doctors.map((d) => ({
      ...d,
      titleAr: titles.get(d.id)?.titleAr ?? null,
      titleEn: titles.get(d.id)?.titleEn ?? null,
      profile: titles.get(d.id)?.profile ?? null,
    }));

    // Specialties not booked online yet: shown as "ask us on WhatsApp".
    const others = await tx
      .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
      .from(departments)
      .where(eq(departments.isActive, false))
      .orderBy(asc(departments.sortOrder));

    // The next free times for a first visit (the consultation, else the first in-clinic service).
    const allServices = catalog.departments.flatMap((d) => d.services);
    const inClinic = allServices.filter((s) => !s.isVirtual);
    const first =
      inClinic.find((s) => /consult/i.test(s.nameEn)) ?? inClinic[0] ?? allServices[0] ?? null;
    let nextFree: string[] = [];
    const branchId = catalog.branches[0]?.id;
    if (catalog.enabled && first && branchId) {
      try {
        const docs = await onlineDoctors(tx, branchId);
        if (docs.length) {
          const slots = await findFreeSlots(tx, {
            branchId,
            serviceId: first.id,
            practitionerIds: docs.map((d) => d.id),
            from: addMinutes(now, settings.onlineMinNoticeMinutes),
            days: Math.min(settings.onlineHorizonDays, 14),
            limit: 30,
          });
          nextFree = [...new Set(slots.map((s) => s.startsAt.toISOString()))].slice(0, 3);
        }
      } catch {
        nextFree = []; // the website never fails because of availability
      }
    }

    // Offers: the clinic's active session packages (prices only when shown online).
    const packs = await tx
      .select({
        id: packageTemplates.id,
        nameAr: packageTemplates.nameAr,
        nameEn: packageTemplates.nameEn,
        sessions: packageTemplates.sessionsCount,
        priceHalalas: packageTemplates.priceHalalas,
        validityDays: packageTemplates.validityDays,
        serviceId: packageTemplates.serviceId,
        servicePrice: services.priceHalalas,
      })
      .from(packageTemplates)
      .innerJoin(services, eq(services.id, packageTemplates.serviceId))
      .where(eq(packageTemplates.isActive, true))
      .orderBy(asc(packageTemplates.priceHalalas));
    const onlineIds = new Set(allServices.map((x) => x.id));
    const offers = packs.map((o) => ({
      ...o,
      priceHalalas: settings.showPricesOnline ? o.priceHalalas : null,
      servicePrice: settings.showPricesOnline ? o.servicePrice : null,
      bookable: onlineIds.has(o.serviceId),
    }));

    return {
      site: (settings.site ?? {}) as SiteContent,
      offers,
      catalog,
      doctors,
      others,
      branches: siteBranches,
      nextFree,
      nextFreeBranchId: branchId ?? null,
      firstService: first,
      videoService: allServices.find((s) => s.isVirtual) ?? null,
    };
  });
}

export type ClinicSiteData = Awaited<ReturnType<typeof loadClinicSite>>;
