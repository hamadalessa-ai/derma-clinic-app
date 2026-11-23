/**
 * Before / after photos: doctors and nurses add them (image + area + angle), compare them, hide
 * a wrong one with a reason. Who sees them: doctors, nurses, the clinic admin — never reception
 * or patients, in code and in the database. Never edited.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { DEMO_SKIN_PHOTOS } from "@/db/demo-photos";
import { clinicalPhotos } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { getFileStore } from "@/lib/files/store";
import { addPhoto, PhotoError, photosForPatient, voidPhoto } from "@/lib/photos/photos";
import { patientDbContext } from "@/lib/portal/session";
import { admin, DERMA, drSara, nurse, patient, reception } from "./fixtures";

afterAll(closeDb);

const FILE = "D-0021";
const image = Buffer.from(DEMO_SKIN_PHOTOS["cheek-before"], "base64");

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PhotoError) return e.code;
    if (e instanceof PermissionError) return "not_allowed";
    throw e;
  }
  return "ok";
};

async function stored(kind = "clinical_photo") {
  return withActor(nurse, (tx) =>
    getFileStore().put(
      { tx, tenantId: DERMA, userId: nurse.userId },
      { kind, mimeType: "image/jpeg", data: image },
    ),
  );
}

describe("adding and comparing photos", () => {
  let photoId = "";

  it("a nurse adds photos; they come back grouped by area, oldest first", async () => {
    const before = await stored();
    const after = await stored();
    const a = await withActor(nurse, (tx) =>
      addPhoto(
        tx,
        nurse,
        { patientId: patient(FILE), fileId: before.id, area: "cheeks", view: "front" },
        "2036-01-10",
      ),
    );
    await withActor(nurse, (tx) =>
      addPhoto(
        tx,
        nurse,
        { patientId: patient(FILE), fileId: after.id, area: "cheeks", view: "front", note: "after 3" },
        "2036-03-10",
      ),
    );
    photoId = a.id;
    const data = await withActor(drSara, (tx) => photosForPatient(tx, drSara, patient(FILE)));
    const cheeks = data.areas.find((x) => x.area === "cheeks")!;
    expect(cheeks.photos.map((p) => p.takenOn)).toEqual(["2036-01-10", "2036-03-10"]);
    expect(cheeks.photos[1].note).toBe("after 3");
  });

  it("refuses a wrong area or a file that is not a clinical photo", async () => {
    const f = await stored();
    expect(
      await code(
        withActor(nurse, (tx) =>
          addPhoto(tx, nurse, { patientId: patient(FILE), fileId: f.id, area: "elbow", view: "front" }),
        ),
      ),
    ).toBe("bad_area");
    const sig = await stored("signature");
    expect(
      await code(
        withActor(nurse, (tx) =>
          addPhoto(tx, nurse, { patientId: patient(FILE), fileId: sig.id, area: "face", view: "front" }),
        ),
      ),
    ).toBe("bad_file");
  });

  it("a wrong photo is hidden with a reason, once; photos are never edited", async () => {
    await withActor(drSara, (tx) => voidPhoto(tx, drSara, { photoId, reason: "Wrong patient" }));
    expect(
      await code(withActor(drSara, (tx) => voidPhoto(tx, drSara, { photoId, reason: "again" }))),
    ).toBe("not_found");
    const data = await withActor(drSara, (tx) => photosForPatient(tx, drSara, patient(FILE)));
    expect(data.areas.find((x) => x.area === "cheeks")!.photos).toHaveLength(1);
    await expect(
      withActor(drSara, (tx) =>
        tx.execute(sql`update clinical_photos set area = 'face' where id = ${photoId}`),
      ),
    ).rejects.toThrow();
  });
});

describe("who sees photos", () => {
  it("the clinic admin sees them but cannot add; reception sees nothing", async () => {
    const data = await withActor(admin, (tx) => photosForPatient(tx, admin, patient("D-0013")));
    expect(data.total).toBeGreaterThan(0);
    const f = await stored();
    expect(
      await code(
        withActor(admin, (tx) =>
          addPhoto(tx, admin, { patientId: patient(FILE), fileId: f.id, area: "face", view: "front" }),
        ),
      ),
    ).toBe("not_allowed");
    expect(
      await code(withActor(reception, (tx) => photosForPatient(tx, reception, patient("D-0013")))),
    ).toBe("not_allowed");
    const rows = await withActor(reception, (tx) =>
      tx.select().from(clinicalPhotos).where(eq(clinicalPhotos.patientId, patient("D-0013"))),
    );
    expect(rows).toHaveLength(0);
  });

  it("patients never see photos through their own page", async () => {
    const rows = await withTenant(patientDbContext(DERMA, patient("D-0013")), (tx) =>
      tx.execute(sql`select id from clinical_photos`),
    );
    expect(rows).toHaveLength(0);
  });

  it("demo data: D-0013 has cheeks and forehead, before and after", async () => {
    const data = await withActor(drSara, (tx) => photosForPatient(tx, drSara, patient("D-0013")));
    expect(data.areas.map((a) => [a.area, a.photos.length])).toEqual([
      ["forehead", 2],
      ["cheeks", 2],
    ]);
  });
});
