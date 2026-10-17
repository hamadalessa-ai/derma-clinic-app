/** Rebuilds the local development database "derma_dev" from db/setup.sql. */
import { createLocalDatabase } from "../src/db/local-setup";

const adminUrl =
  process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres";
const demoPassword = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";

createLocalDatabase({ adminUrl, dbName: "derma_dev", demoPassword })
  .then(({ appUrl }) => {
    console.log("Local database derma_dev is ready.");
    console.log(`App connection (local only): ${appUrl.replace(/:[^:@/]+@/, ":****@")}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
