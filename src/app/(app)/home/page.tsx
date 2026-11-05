import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

/**
 * Staff home (/home; "/" is the clinic website and sends signed-in staff here): straight to each person's main screen (no dashboard to click through).
 * Doctors → My Day; reception and admins → Calendar; platform owner → Platform.
 */
export default async function Home() {
  const ctx = await requirePermission("dashboard:view");
  if (can(ctx.roles, "my_day:view")) redirect("/my-day");
  if (can(ctx.roles, "calendar:view")) redirect("/calendar");
  if (can(ctx.roles, "platform:read")) redirect("/platform");
  redirect("/account");
}
