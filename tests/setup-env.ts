import { inject } from "vitest";

// Every test talks to the database as the restricted clinic_app role.
process.env.DATABASE_URL = inject("appUrl");
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.BETTER_AUTH_URL = "http://derma.localhost:3000";
process.env.APP_ROOT_DOMAIN = "localhost";
process.env.DEMO_DEFAULT_CLINIC = "derma";
