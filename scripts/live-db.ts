/**
 * The LIVE database (real clinics). Run by GitHub workflows, never by hand with real secrets
 * in a terminal history:
 *   pnpm exec tsx scripts/live-db.ts setup     first time, on an EMPTY database
 *   pnpm exec tsx scripts/live-db.ts upgrade   apply new changes, keeping all data
 *   pnpm exec tsx scripts/live-db.ts plan      only list what "upgrade" would apply
 * Secrets (GitHub → Settings → Secrets and variables → Actions), see docs/GO_LIVE.md:
 *   LIVE_ADMIN_URL         live Supabase "Session pooler" string, user postgres.<project-ref>
 *   LIVE_APP_DB_PASSWORD   the clinic_app password inside the live Vercel DATABASE_URL (setup)
 *   LIVE_OWNER_EMAIL       the platform owner's sign-in email (setup)
 *   LIVE_OWNER_PASSWORD    the platform owner's first password (setup; change it after)
 */
import {
  buildLiveUpgradeSql,
  liveState,
  runLiveSetup,
  runLiveUpgrade,
} from "../src/db/live-upgrade";

const cmd = process.argv[2];
const adminUrl = process.env.LIVE_ADMIN_URL ?? process.env.REHEARSAL_URL ?? "";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!adminUrl) fail("Missing secret LIVE_ADMIN_URL. See docs/GO_LIVE.md.");
if (/clinic_app/.test(adminUrl)) fail("LIVE_ADMIN_URL must use the admin user, not clinic_app.");

async function main() {
  if (cmd === "setup") {
    const { tables } = await runLiveSetup({
      adminUrl,
      appPassword: process.env.LIVE_APP_DB_PASSWORD ?? "",
      ownerEmail: process.env.LIVE_OWNER_EMAIL ?? "",
      ownerPassword: process.env.LIVE_OWNER_PASSWORD ?? "",
    });
    console.log(
      `Live database set up (${tables} tables, no demo data). Next: docs/GO_LIVE.md step 5.`,
    );
  } else if (cmd === "plan") {
    const state = await liveState(adminUrl);
    if (!state.live) fail("Not a live database (no ops.schema_upgrades).");
    const { pending } = buildLiveUpgradeSql(state.applied);
    console.log(
      pending.length
        ? `Will apply: ${pending.join(", ")}`
        : "No new database changes; the security layer is re-applied.",
    );
  } else if (cmd === "upgrade") {
    const { applied } = await runLiveUpgrade({ adminUrl });
    console.log(
      applied.length
        ? `Applied: ${applied.join(", ")}`
        : "No new database changes; security layer re-applied.",
    );
  } else {
    fail("Usage: live-db.ts setup | plan | upgrade");
  }
}

main().catch((err: unknown) => {
  // Never print the connection string; database errors don't contain the passwords.
  fail(`Failed, nothing was changed: ${err instanceof Error ? err.message : String(err)}`);
});
