import { demoId } from "@/db/seed-data";
import type { Actor } from "@/lib/auth/db";

export const DERMA = demoId("tenant:derma");
export const LAMSA = demoId("tenant:lamsa");
export const RIYADH = demoId("derma:branch:riyadh");
export const JEDDAH = demoId("derma:branch:jeddah");

export const member = (key: string) => demoId(`derma:member:${key}`);
export const patient = (file: string) => demoId(`derma:patient:${file}`);
export const service = (code: string) => demoId(`derma:service:${code}`);
export const room = (key: string) => demoId(`derma:room:${key}`);
export const device = (key: string) => demoId(`derma:device:${key}`);

function actor(key: string, roles: Actor["roles"], branch: string | null, tenantId = DERMA): Actor {
  return {
    tenantId,
    userId: `usr_${key}`,
    roles,
    memberId: tenantId === DERMA ? member(key) : demoId(`lamsa:member:${key}`),
    restrictedBranchId: branch,
  };
}

export const admin = actor("derma-admin", ["clinic_admin"], null);
export const drSara = actor("derma-dr-sara", ["practitioner"], RIYADH);
export const drFaisal = actor("derma-dr-faisal", ["practitioner"], RIYADH);
export const drReem = actor("derma-dr-reem", ["practitioner"], RIYADH);
export const drLina = actor("derma-dr-lina", ["practitioner"], JEDDAH);
export const reception = actor("derma-rec-ruh1", ["receptionist"], RIYADH);
export const receptionJeddah = actor("derma-rec-jed", ["receptionist"], JEDDAH);
export const lamsaAdmin = actor("lamsa-admin", ["clinic_admin"], null, LAMSA);

/** A Riyadh clinic time on a fixed future date (Sunday 13 Jan 2030 unless given). */
export function riyadhAt(time: string, day = "2030-01-13") {
  return new Date(`${day}T${time}:00+03:00`);
}
