/**
 * Clears ONE demo clinic's patients (see src/db/clear-demo-patients.ts).
 * Run by the "Clear demo patients" GitHub workflow with the secret SUPABASE_ADMIN_URL.
 */
import { runClearDemoPatients } from "../src/db/clear-demo-patients";

const adminUrl = process.env.SUPABASE_ADMIN_URL ?? "";
const slug = process.env.CLINIC ?? "";
const confirm = process.env.CONFIRM ?? "";

if (!adminUrl) {
  console.error("Missing the SUPABASE_ADMIN_URL secret.");
  process.exit(1);
}
if (/clinic_app/.test(adminUrl)) {
  console.error("SUPABASE_ADMIN_URL must use the admin user, not clinic_app.");
  process.exit(1);
}
if (!slug || confirm !== slug) {
  console.error('Type the clinic address again in "confirm" (for example: derma).');
  process.exit(1);
}

runClearDemoPatients({ adminUrl, slug })
  .then((report) => console.log(report || "Nothing to clear."))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Nothing was changed: ${msg}`);
    process.exit(1);
  });
