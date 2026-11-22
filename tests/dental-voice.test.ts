/**
 * Dental voice charting: what the dentist says (or types) read into chart entries by fixed
 * rules, and saving the checked list in one go (doctors and nurses only).
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { chartHistory, DentalError, recordTeeth } from "@/lib/dental/chart";
import { currentChart } from "@/lib/dental/teeth";
import { parseDictation } from "@/lib/dental/voice";
import { drNawaf, nurse, patient, reception } from "./fixtures";

afterAll(closeDb);

const read = (text: string) =>
  parseDictation(text).items.map((i) => `${i.tooth}:${i.condition}${i.surfaces ? `:${i.surfaces}` : ""}`);

describe("reading the dictation (pure)", () => {
  it("finding after the teeth, with surfaces", () => {
    expect(read("16 MO caries, 26 crown, 36 missing")).toEqual([
      "16:caries:MO",
      "26:crown",
      "36:missing",
    ]);
  });

  it("without any punctuation, as speech usually comes", () => {
    expect(read("tooth 16 caries 26 crown 37 root canal")).toEqual([
      "16:caries",
      "26:crown",
      "37:root_canal",
    ]);
  });

  it("finding before the teeth, several teeth at once", () => {
    expect(read("caries 16 17 mesial occlusal, crown 26")).toEqual([
      "16:caries:MO",
      "17:caries:MO",
      "26:crown",
    ]);
  });

  it("Arabic words and digits", () => {
    expect(read("١٦ تسوس، ٢٦ تاج، ٣٦ مفقود، 47 علاج العصب، 11 حشوة")).toEqual([
      "16:caries",
      "26:crown",
      "36:missing",
      "47:root_canal",
      "11:filled",
    ]);
    expect(read("السن 46 يحتاج خلع و 21 زراعة")).toEqual(["46:extraction_needed", "21:implant"]);
  });

  it("the last finding for a tooth counts; teeth without a finding are reported", () => {
    const d = parseDictation("16 caries, 16 filled MOD, 24");
    expect(d.items).toEqual([{ tooth: 16, condition: "filled", surfaces: "MOD" }]);
    expect(d.withoutFinding).toEqual([24]);
  });

  it("ignores numbers that are not teeth and English words made of surface letters", () => {
    expect(read("19 caries, 2026 crown")).toEqual([]);
    expect(read("16 old filling")).toEqual(["16:filled"]);
    expect(read("36 missing MO")).toEqual(["36:missing"]);
  });
});

describe("saving the checked list", () => {
  it("records every tooth in one go, as new chart rows", async () => {
    const rows = await withActor(nurse, (tx) =>
      recordTeeth(tx, nurse, {
        patientId: patient("D-0016"),
        items: parseDictation("15 caries DO, 25 crown").items,
      }),
    );
    expect(rows).toHaveLength(2);
    const now = currentChart(
      await withActor(drNawaf, (tx) => chartHistory(tx, drNawaf, patient("D-0016"))),
    );
    expect(now.get(15)).toMatchObject({ condition: "caries", surfaces: "OD" });
    expect(now.get(25)?.condition).toBe("crown");
  });

  it("all or nothing; reception may not", async () => {
    await expect(
      withActor(drNawaf, (tx) =>
        recordTeeth(tx, drNawaf, {
          patientId: patient("D-0016"),
          items: [
            { tooth: 14, condition: "caries" },
            { tooth: 19, condition: "crown" },
          ],
        }),
      ),
    ).rejects.toThrow(DentalError);
    const now = currentChart(
      await withActor(drNawaf, (tx) => chartHistory(tx, drNawaf, patient("D-0016"))),
    );
    expect(now.get(14)).toBeUndefined();
    await expect(
      withActor(reception, (tx) =>
        recordTeeth(tx, reception, {
          patientId: patient("D-0016"),
          items: [{ tooth: 14, condition: "caries" }],
        }),
      ),
    ).rejects.toThrow(PermissionError);
  });
});
