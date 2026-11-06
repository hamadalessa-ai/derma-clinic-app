"use server";

import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { parse, PublicError, publicAction } from "@/lib/actions";
import { parseInviteToken } from "@/lib/team/invite";
import { setInvitedPassword } from "@/lib/team/team";

const input = z.object({
  token: z.string().max(200),
  password: z.string().min(10).max(128),
});

/** From the invitation link: the new staff member sets their own password. */
export async function setInvitePasswordAction(v: z.input<typeof input>) {
  return publicAction(async (tenant) => {
    const d = parse(input, v);
    const userId = parseInviteToken(tenant.id, d.token);
    if (!userId) throw new PublicError("team_invite_invalid");
    await withTenant(tenant.id, (tx) => setInvitedPassword(tx, userId, d.password));
    return null;
  });
}
