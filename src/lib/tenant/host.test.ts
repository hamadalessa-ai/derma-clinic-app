import { describe, expect, it } from "vitest";
import { clinicSlugFromHost } from "./host";

describe("clinicSlugFromHost", () => {
  const dev = (host: string | null) => clinicSlugFromHost(host, "localhost", "derma");

  it("reads the clinic from the subdomain in development", () => {
    expect(dev("derma.localhost:3000")).toBe("derma");
    expect(dev("lamsa.localhost:3000")).toBe("lamsa");
    expect(dev("LAMSA.localhost")).toBe("lamsa");
  });

  it("falls back to DEMO_DEFAULT_CLINIC when there is no clinic subdomain", () => {
    expect(dev("localhost:3000")).toBe("derma");
    expect(dev("www.localhost")).toBe("derma");
    expect(dev(null)).toBe("derma");
  });

  it("treats Vercel links as having no clinic subdomain", () => {
    expect(dev("derma-clinic-app.vercel.app")).toBe("derma");
    expect(dev("derma-clinic-app-git-main-team.vercel.app")).toBe("derma");
  });

  it("works with a real root domain later", () => {
    expect(clinicSlugFromHost("lamsa.clinicapp.sa", "clinicapp.sa", "derma")).toBe("lamsa");
    expect(clinicSlugFromHost("clinicapp.sa", "clinicapp.sa", "derma")).toBe("derma");
    expect(clinicSlugFromHost("evil.com", "clinicapp.sa", "derma")).toBe("derma");
  });

  it("ignores nested or malformed subdomains", () => {
    expect(dev("a.b.localhost")).toBe("derma");
    expect(dev("-bad-.localhost")).toBe("derma");
    expect(dev("x_y.localhost")).toBe("derma");
  });

  it("returns null without a valid default", () => {
    expect(clinicSlugFromHost("localhost", "localhost", null)).toBeNull();
    expect(clinicSlugFromHost("localhost", "localhost", "Bad Slug!")).toBeNull();
  });
});
