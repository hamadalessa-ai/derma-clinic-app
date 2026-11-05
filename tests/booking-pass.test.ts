/** "Verified mobile" pass for OTP-first online booking: signed, per clinic, per number, 30 minutes. */
import { describe, expect, it } from "vitest";
import { BOOKING_PASS_MINUTES, checkPhonePass, phonePass } from "@/lib/verify/pass";
import { DERMA, LAMSA } from "./fixtures";

const now = new Date("2036-01-01T10:00:00Z");

describe("booking pass", () => {
  it("proves the verified mobile for this clinic only", () => {
    const pass = phonePass(DERMA, "0590000123", now);
    expect(checkPhonePass(DERMA, pass, now)).toBe("0590000123");
    expect(checkPhonePass(LAMSA, pass, now)).toBeNull();
  });

  it("can't be edited to another number, and expires", () => {
    const pass = phonePass(DERMA, "0590000123", now);
    expect(checkPhonePass(DERMA, pass.replace("0590000123", "0590000999"), now)).toBeNull();
    const later = new Date(now.getTime() + (BOOKING_PASS_MINUTES + 1) * 60_000);
    expect(checkPhonePass(DERMA, pass, later)).toBeNull();
    expect(checkPhonePass(DERMA, "nonsense", now)).toBeNull();
    expect(checkPhonePass(DERMA, undefined, now)).toBeNull();
  });
});
