"use server";

import { cookies } from "next/headers";
import { BRANCH_COOKIE, getStaffContext } from "@/lib/auth/session";

/** Switches the active branch, but only to a branch this person is allowed to see. */
export async function setActiveBranch(branchId: string) {
  const ctx = await getStaffContext();
  if (!ctx || !ctx.branches.some((b) => b.id === branchId)) return;
  (await cookies()).set(BRANCH_COOKIE, branchId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}
