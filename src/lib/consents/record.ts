import "server-only";
import { eq } from "drizzle-orm";
import { patients, users } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, getStaffContext } from "@/lib/auth/session";
import { getFileStore } from "@/lib/files/store";
import { formatDualDate, formatTime } from "@/lib/format";
import { getConsent, isIntact } from "./consents";

/** Loads a signed consent with everything the print page and PDF show. Null when not allowed. */
export async function loadConsentRecord(id: string) {
  const ctx = await getStaffContext();
  if (!ctx || !can(ctx.roles, "patients:read") || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withActor(actorOf(ctx), async (tx) => {
    const consent = await getConsent(tx, id);
    if (!consent) return null;
    const [patient] = await tx.select().from(patients).where(eq(patients.id, consent.patientId));
    const [witness] = await tx.select().from(users).where(eq(users.id, consent.witnessUserId));
    const signature = await getFileStore().get({ tx }, consent.signatureFileId);
    return {
      tenant: ctx.tenant,
      consent,
      patient,
      witnessName: witness?.name ?? consent.witnessUserId,
      signature,
      intact: isIntact(consent),
      signedAtAr: `${formatDualDate(consent.signedAt, "ar")} · ${formatTime(consent.signedAt, "ar")}`,
      signedAtEn: `${formatDualDate(consent.signedAt, "en")} · ${formatTime(consent.signedAt, "en")}`,
    };
  });
}
