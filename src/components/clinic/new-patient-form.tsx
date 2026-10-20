"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { createPatientAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

const schema = z.object({
  fullNameAr: z.string().trim().min(3),
  fullNameEn: z.string().trim().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^05\d{8}$/),
  gender: z.enum(["male", "female"]),
  dateOfBirth: z.string().optional(),
  idType: z.enum(["national_id", "iqama", "passport"]),
  idNumber: z.string().trim().optional(),
  guardianFile: z.string().trim().optional(),
  guardianRelationAr: z.string().trim().optional(),
});
type Values = z.infer<typeof schema>;

export function NewPatientForm() {
  const t = useTranslations("patientsX");
  const tp = useTranslations("patients");
  const te = useTranslations("errors");
  const router = useRouter();
  const { run, pending, error } = useAction();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { gender: "female", idType: "national_id" },
  });
  const field = (name: keyof Values, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        aria-invalid={!!form.formState.errors[name]}
        {...form.register(name)}
        {...props}
      />
      {form.formState.errors[name] && <p className="text-destructive text-xs">{te("invalid")}</p>}
    </div>
  );
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={form.handleSubmit((v) =>
        run(
          () =>
            createPatientAction({
              ...v,
              dateOfBirth: v.dateOfBirth || "",
              idNumber: v.idNumber || "",
            }),
          (r) => router.push(`/patients/${r.id}`),
        ),
      )}
    >
      {field("fullNameAr", t("nameAr"))}
      {field("fullNameEn", t("nameEn"), { dir: "ltr" })}
      {field("phone", tp("phone"), { dir: "ltr", placeholder: "05XXXXXXXX", inputMode: "numeric" })}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gender">{tp("gender")}</Label>
        <Select id="gender" {...form.register("gender")}>
          <option value="female">{tp("female")}</option>
          <option value="male">{tp("male")}</option>
        </Select>
      </div>
      {field("dateOfBirth", tp("dateOfBirth"), { type: "date", dir: "ltr" })}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="idType">{t("idType")}</Label>
        <Select id="idType" {...form.register("idType")}>
          <option value="national_id">{t("national_id")}</option>
          <option value="iqama">{t("iqama")}</option>
          <option value="passport">{t("passport")}</option>
        </Select>
      </div>
      {field("idNumber", t("idNumber"), { dir: "ltr" })}
      {field("guardianFile", t("guardianFile"), { dir: "ltr", placeholder: "D-0008" })}
      {field("guardianRelationAr", t("relationAr"))}
      <div className="sm:col-span-2">
        <FormError message={error} />
      </div>
      <Button type="submit" disabled={pending} className="sm:col-span-2 sm:justify-self-end">
        {t("create")}
      </Button>
    </form>
  );
}
