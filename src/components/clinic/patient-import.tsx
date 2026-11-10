"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { checkImportAction, runImportAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { TEMPLATE_CSV } from "@/lib/patients/import-template";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

type Check = {
  ready: number;
  withPackage: number;
  problems: { line: number; problems: string[]; name: string }[];
  problemCount: number;
  missingColumns: string[];
  total: number;
};

/** Upload a CSV → see what will be imported and which rows can't be → import. */
export function PatientImport() {
  const t = useTranslations("patientImport");
  const check = useAction();
  const run = useAction();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<Check | null>(null);
  const [done, setDone] = useState<{ imported: number; packages: number; skipped: number } | null>(
    null,
  );

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "patients-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="patient-import">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 text-sm">
          <ol className="flex list-decimal flex-col gap-1 ps-5">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          <p className="text-muted-foreground text-xs">{t("columns")}</p>
          <Button variant="outline" size="sm" className="self-start" onClick={downloadTemplate}>
            <Download />
            {t("template")}
          </Button>
        </CardContent>
      </Card>

      {!done && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 text-sm">
              <FileSpreadsheet className="text-brand-strong size-6" aria-hidden />
              <span className="flex-1">{fileName || t("choose")}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                data-testid="import-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setFileName(f.name);
                  setResult(null);
                  f.text().then((text) => {
                    setCsv(text);
                    check.run(
                      () => checkImportAction({ csv: text }),
                      (r) => setResult(r),
                    );
                  });
                }}
              />
            </label>
            {check.pending && <p className="text-muted-foreground text-sm">{t("checking")}</p>}
            <FormError message={check.error} />
          </CardContent>
        </Card>
      )}

      {result && !done && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5 text-sm" data-testid="import-check">
            {result.missingColumns.length > 0 ? (
              <Notice tone="danger">
                {t("missingColumns", {
                  columns: result.missingColumns.map((c) => t(`col.${c}`)).join("، "),
                })}
              </Notice>
            ) : (
              <>
                <p className="font-semibold">
                  {t("summary", {
                    ready: result.ready,
                    total: result.total,
                    packages: result.withPackage,
                  })}
                </p>
                {result.problemCount > 0 && (
                  <div className="flex flex-col gap-1">
                    <p>{t("problemsTitle", { n: result.problemCount })}</p>
                    <ul className="bg-muted max-h-72 overflow-auto rounded-lg p-3 text-xs">
                      {result.problems.map((p) => (
                        <li key={p.line} className="py-0.5">
                          {t("line", { line: p.line })} · {p.name || "—"} ·{" "}
                          {p.problems.map((x) => t(`problem.${x}`)).join("، ")}
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground text-xs">{t("problemsHint")}</p>
                  </div>
                )}
                <Button
                  className="self-start"
                  disabled={result.ready === 0}
                  loading={run.pending}
                  onClick={() =>
                    csv &&
                    run.run(
                      () => runImportAction({ csv }),
                      (r) => setDone(r),
                    )
                  }
                  data-testid="import-run"
                >
                  <Upload />
                  {t("import", { n: result.ready })}
                </Button>
                <FormError message={run.error} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {done && (
        <Notice tone="success">
          <span data-testid="import-done">
            {t("done", { imported: done.imported, packages: done.packages, skipped: done.skipped })}{" "}
            <Link href="/patients" className="underline">
              {t("toPatients")}
            </Link>
          </span>
        </Notice>
      )}
    </div>
  );
}
