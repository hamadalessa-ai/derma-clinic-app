import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";

/**
 * Home: straight to each person's main screen (no dashboard to click through).
 * Doctors → My Day; reception and admins → Calendar; platform owner → Platform.
 */
export default async function Home() {
  const ctx = await requireStaff();
  if (can(ctx.roles, "my_day:view")) redirect("/my-day");
  if (can(ctx.roles, "calendar:view")) redirect("/calendar");
  if (can(ctx.roles, "platform:read")) redirect("/platform");
  redirect("/account");
}
