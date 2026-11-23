/**
 * Database schema.
 *
 * Isolation rules (see CLAUDE.md):
 * - Every table except `tenants` and the Better Auth tables has `tenant_id`.
 * - Child rows reference parents with composite keys (tenant_id, id), so a row can never
 *   point at a branch/room/department that belongs to a different clinic.
 * - Row-Level Security policies live in db/rls.sql (Drizzle cannot express FORCE RLS).
 */
import { sql } from "drizzle-orm";
import { PHOTO_AREAS, PHOTO_VIEWS } from "../lib/photos/areas";
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const tenantId = () => uuid("tenant_id").notNull();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const memberRole = pgEnum("member_role", [
  "clinic_admin",
  "practitioner",
  "receptionist",
  /** Nurse / doctor's assistant: works for the doctors linked in care_team. */
  "assistant",
]);
export const gender = pgEnum("gender", ["male", "female"]);
/**
 * Clinic account status (set by the platform owner): active; read_only (staff can look, not change;
 * no online booking, WhatsApp or AI); suspended (no staff sign-in, public pages closed); closed
 * (like read_only for staff so they can take their records out, public pages closed).
 */
export const clinicStatus = pgEnum("clinic_status", ["active", "read_only", "suspended", "closed"]);
/** Subscription plan (features + default monthly limits): src/lib/platform/plans.ts. */
export const planTier = pgEnum("plan_tier", ["basic", "pro", "enterprise"]);
export const statementStatus = pgEnum("statement_status", ["issued", "paid", "void"]);
export const idType = pgEnum("id_type", ["national_id", "iqama", "passport"]);
export const appointmentStatus = pgEnum("appointment_status", [
  "pending", // online booking waiting for reception approval (still holds the slot)
  "booked",
  "confirmed",
  "arrived",
  "in_session",
  "completed",
  "no_show",
  "cancelled",
]);
export const medicalFlagKind = pgEnum("medical_flag_kind", [
  "allergy",
  "contraindication",
  "medication",
]);
export const paymentMethod = pgEnum("payment_method", ["cash", "card", "transfer"]);
export const sessionEventKind = pgEnum("session_event_kind", [
  "deduction", // automatic, at check-in (max one per appointment)
  "override", // staff correction, reason required
]);
export const noteStatus = pgEnum("note_status", ["draft", "signed"]);
/** Where an appointment was created. */
export const bookingSource = pgEnum("booking_source", ["reception", "online", "whatsapp"]);
export const requestStatus = pgEnum("request_status", ["pending", "approved", "rejected"]);

/** Postgres timestamp range, e.g. [10:00, 10:45). Used to forbid overlapping bookings. */
const tstzrange = customType<{ data: string }>({ dataType: () => "tstzrange" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// ─── Clinics ────────────────────────────────────────────────────────────────

/** Per-clinic monthly limits (platform owner). AI = receptionist replies + scribe drafts. */
export interface ClinicLimits {
  aiMonthly?: number | null;
  whatsappMonthly?: number | null;
}

export const tenants = pgTable("tenants", {
  id: id(),
  slug: text("slug").notNull().unique(), // subdomain, e.g. "derma"
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  brandColor: text("brand_color").notNull().default("#28817a"),
  isDemo: boolean("is_demo").notNull().default(true),
  status: clinicStatus("status").notNull().default("active"),
  /** Why the status was last changed (shown to the owner and the clinic). */
  statusReason: text("status_reason"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  /** Monthly usage limits set by the platform owner (null / missing = no limit). */
  limits: jsonb("limits").$type<ClinicLimits>().notNull().default({}),
  // ── Subscription (platform owner; billing is recorded by hand for now) ──
  plan: planTier("plan").notNull().default("pro"),
  /** Monthly price before VAT, in halalas (0 = free / not billed). */
  monthlyPriceHalalas: integer("monthly_price_halalas").notNull().default(0),
  /** No statements are issued before this day. */
  trialEndsOn: date("trial_ends_on"),
  /** Days after a statement's due date before the clinic becomes read-only automatically. */
  billingGraceDays: smallint("billing_grace_days").notNull().default(7),
  /** Read-only because of an unpaid statement: lifted automatically once it is paid. */
  pausedForBilling: boolean("paused_for_billing").notNull().default(false),
  // ── WhatsApp connection (platform owner; the clinic does nothing) ──
  /** Meta's id for the clinic's WhatsApp number (incoming messages are routed by it). */
  whatsappPhoneNumberId: text("whatsapp_phone_number_id").unique(),
  whatsappBusinessAccountId: text("whatsapp_business_account_id"),
  /** The number as patients see it, e.g. +966 50 123 4567 (display only). */
  whatsappDisplayPhone: text("whatsapp_display_phone"),
  /**
   * The clinic's own access token, ENCRYPTED (src/lib/security/secret-box.ts). Empty = use the
   * platform's token (WHATSAPP_ACCESS_TOKEN), e.g. when all numbers sit in our own Meta account.
   */
  whatsappTokenEnc: text("whatsapp_token_enc"),
  /** Switched on by the platform owner after a successful test message. */
  whatsappLive: boolean("whatsapp_live").notNull().default(false),
  createdAt: createdAt(),
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    cityAr: text("city_ar").notNull(),
    cityEn: text("city_en").notNull(),
    /** Map link sent in WhatsApp confirmations. */
    mapUrl: text("map_url"),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [unique("branches_tenant_id_id_key").on(t.tenantId, t.id)],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // e.g. "dermatology"
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("departments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("departments_tenant_code_key").on(t.tenantId, t.code),
  ],
);

// ─── Staff login (Better Auth tables; global, no patient data) ───────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(), // Arabic (main) name
  nameEn: text("name_en"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isPlatformOwner: boolean("is_platform_owner").notNull().default(false),
  /** Two-step verification (authenticator app) is on — Better Auth's twoFactor plugin. */
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"), // bcrypt hash
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Two-step verification secrets (Better Auth twoFactor plugin). The authenticator secret and the
 * backup codes are stored ENCRYPTED with BETTER_AUTH_SECRET. Staff login data, no patient data.
 */
export const twoFactors = pgTable(
  "two_factors",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [
    index("two_factors_user_id_idx").on(t.userId),
    index("two_factors_secret_idx").on(t.secret),
  ],
);

/**
 * Rate limits that hold across ALL clinics (staff sign-in, code requests): one row per attempt.
 * Not clinic data: the bucket is a SHA-256 hash (never an email, mobile or IP in clear).
 */
export const globalRateHits = pgTable(
  "global_rate_hits",
  {
    id: id(),
    bucket: text("bucket").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("global_rate_hits_bucket_idx").on(t.bucket, t.createdAt)],
);

// ─── Clinic membership ──────────────────────────────────────────────────────

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roles: memberRole("roles").array().notNull(), // one or more, e.g. {clinic_admin,practitioner}
    branchId: uuid("branch_id"), // null = all branches
    /** Doctors: used by "female / male doctor" preference on online booking. */
    gender: gender("gender"),
    titleAr: text("title_ar"),
    titleEn: text("title_en"),
    /** Doctors: public profile for the clinic website (specialty, credentials, languages). */
    profile: jsonb("profile").$type<MemberProfile>(),
    /** Set when the person left the clinic: no sign-in, not bookable; history is kept. */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tenant_members_tenant_id_id_key").on(t.tenantId, t.id),
    unique("tenant_members_tenant_user_key").on(t.tenantId, t.userId),
    check("tenant_members_roles_not_empty", sql`cardinality(${t.roles}) > 0`),
    index("tenant_members_user_id_idx").on(t.userId),
    foreignKey({
      name: "tenant_members_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
  ],
);

// ─── Rooms & devices (per branch) ───────────────────────────────────────────

export const rooms = pgTable(
  "rooms",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    /**
     * A "video room" for virtual consultations: not a real room, so it is never reserved
     * (any number of video visits at once; only the doctor's time is booked).
     */
    isVirtual: boolean("is_virtual").notNull().default(false),
    /**
     * A room kept for one department (e.g. the dental clinic with its chair): only that
     * department's services are booked in it, and its services only there. Null = any service.
     */
    departmentId: uuid("department_id"),
    /** Switched off by the clinic admin: no new bookings; past ones keep it. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("rooms_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "rooms_department_fk",
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
    unique("rooms_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    foreignKey({
      name: "rooms_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete("cascade"),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull(),
    roomId: uuid("room_id"),
    deviceType: text("device_type").notNull(), // e.g. "morpheus8"
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("devices_tenant_id_id_key").on(t.tenantId, t.id),
    unique("devices_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    foreignKey({
      name: "devices_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "devices_room_fk",
      columns: [t.tenantId, t.roomId],
      foreignColumns: [rooms.tenantId, rooms.id],
    }),
  ],
);

// ─── Services ───────────────────────────────────────────────────────────────

export const services = pgTable(
  "services",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    durationMinutes: smallint("duration_minutes").notNull(),
    bufferMinutes: smallint("buffer_minutes").notNull().default(0),
    priceHalalas: integer("price_halalas").notNull(), // 1 SAR = 100 halalas
    requiredDeviceType: text("required_device_type"),
    consentCode: text("consent_code"), // which consent template the patient must sign, if any
    onlineBookable: boolean("online_bookable").notNull().default(false),
    /** A video consultation: booked in the branch's video room, joined from a link. */
    isVirtual: boolean("is_virtual").notNull().default(false),
    // ── WhatsApp texts per service (editable by the clinic admin; empty = not sent) ──
    preVisitAr: text("pre_visit_ar"),
    preVisitEn: text("pre_visit_en"),
    postCareAr: text("post_care_ar"),
    postCareEn: text("post_care_en"),
    /** Recall (e.g. Botox follow-up) this many days after a completed visit; null = no recall. */
    recallAfterDays: smallint("recall_after_days"),
    isDemoValue: boolean("is_demo_value").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("services_tenant_code_key").on(t.tenantId, t.code),
    unique("services_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "services_department_fk",
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
  ],
);

/**
 * Which doctors perform a service. No rows for a service = every doctor at the branch may do it;
 * rows = only these doctors (e.g. dental services only for dentists). Set by the clinic admin.
 */
export const servicePractitioners = pgTable(
  "service_practitioners",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull(),
    memberId: uuid("member_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("service_practitioners_tenant_id_id_key").on(t.tenantId, t.id),
    unique("service_practitioners_pair_key").on(t.tenantId, t.serviceId, t.memberId),
    index("service_practitioners_member_idx").on(t.tenantId, t.memberId),
    foreignKey({
      name: "service_practitioners_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "service_practitioners_member_fk",
      columns: [t.tenantId, t.memberId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Care team: which doctors a nurse / assistant works with. She sees those doctors' day, opens
 * their visit screen on the room PC and prepares their notes (the doctor stays the author).
 */
export const careTeam = pgTable(
  "care_team",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    assistantMemberId: uuid("assistant_member_id").notNull(),
    practitionerMemberId: uuid("practitioner_member_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("care_team_tenant_id_id_key").on(t.tenantId, t.id),
    unique("care_team_pair_key").on(t.tenantId, t.assistantMemberId, t.practitionerMemberId),
    index("care_team_practitioner_idx").on(t.tenantId, t.practitionerMemberId),
    foreignKey({
      name: "care_team_assistant_fk",
      columns: [t.tenantId, t.assistantMemberId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "care_team_practitioner_fk",
      columns: [t.tenantId, t.practitionerMemberId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.id],
    }).onDelete("cascade"),
  ],
);

// ─── Staff schedules (per branch) ───────────────────────────────────────────

export const staffSchedules = pgTable(
  "staff_schedules",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    weekday: smallint("weekday").notNull(), // 0 = Sunday … 6 = Saturday
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakStart: time("break_start"), // optional daily break, e.g. 13:00–14:00
    breakEnd: time("break_end"),
    createdAt: createdAt(),
  },
  (t) => [
    check("staff_schedules_hours", sql`${t.startTime} < ${t.endTime}`),
    check(
      "staff_schedules_break",
      sql`(${t.breakStart} is null and ${t.breakEnd} is null) or (${t.breakStart} < ${t.breakEnd} and ${t.breakStart} >= ${t.startTime} and ${t.breakEnd} <= ${t.endTime})`,
    ),
    foreignKey({
      name: "staff_schedules_member_fk",
      columns: [t.tenantId, t.memberId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "staff_schedules_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One-off changes to a doctor's hours on ONE date, replacing the weekly pattern for that date:
 *  - kind "off":   not working that day (any branch);
 *  - kind "hours": works these hours at this branch (several rows = several shifts).
 * An extra working day (e.g. a Friday clinic) is simply "hours" on a day with no weekly shifts.
 */
export const scheduleExceptions = pgTable(
  "schedule_exceptions",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
    day: date("day").notNull(),
    kind: text("kind").notNull(), // off | hours
    branchId: uuid("branch_id"),
    startTime: time("start_time"),
    endTime: time("end_time"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "schedule_exceptions_kind",
      sql`(${t.kind} = 'off' and ${t.branchId} is null and ${t.startTime} is null and ${t.endTime} is null) or (${t.kind} = 'hours' and ${t.branchId} is not null and ${t.startTime} < ${t.endTime})`,
    ),
    index("schedule_exceptions_member_day_idx").on(t.tenantId, t.memberId, t.day),
    foreignKey({
      name: "schedule_exceptions_member_fk",
      columns: [t.tenantId, t.memberId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "schedule_exceptions_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete("cascade"),
  ],
);

// ─── Patients (FAKE DATA ONLY in the demo) ──────────────────────────────────

export const patients = pgTable(
  "patients",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    fileNumber: text("file_number").notNull(),
    fullNameAr: text("full_name_ar").notNull(),
    fullNameEn: text("full_name_en"),
    phone: text("phone").notNull(),
    gender: gender("gender").notNull(),
    dateOfBirth: date("date_of_birth"),
    idType: idType("id_type"),
    idNumber: text("id_number"), // FAKE in the demo (national ID starts with 1, Iqama with 2)
    email: text("email"),
    guardianId: uuid("guardian_id"), // family: linked to one guardian patient
    guardianRelationAr: text("guardian_relation_ar"),
    guardianRelationEn: text("guardian_relation_en"),
    isFake: boolean("is_fake").notNull().default(true),
    /** "online" = created by the patient on /book; reception completes the details later. */
    createdVia: bookingSource("created_via").notNull().default("reception"),
    needsCompletion: boolean("needs_completion").notNull().default(false),
    // ── WhatsApp ──
    /** Language for messages: "ar" (default) or "en". */
    preferredLanguage: text("preferred_language").notNull().default("ar"),
    /** When and how the patient agreed to WhatsApp messages (null = not agreed). */
    whatsappOptInAt: timestamp("whatsapp_opt_in_at", { withTimezone: true }),
    whatsappOptInSource: text("whatsapp_opt_in_source"), // online | patient_page | reception | demo
    /** Patient sent STOP: no more non-essential messages. */
    whatsappOptedOutAt: timestamp("whatsapp_opted_out_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("patients_tenant_id_id_key").on(t.tenantId, t.id),
    check("patients_preferred_language", sql`${t.preferredLanguage} in ('ar', 'en')`),
    index("patients_phone_idx").on(t.tenantId, t.phone),
    unique("patients_tenant_file_key").on(t.tenantId, t.fileNumber),
    check("patients_not_own_guardian", sql`${t.guardianId} is null or ${t.guardianId} <> ${t.id}`),
    foreignKey({
      name: "patients_guardian_fk",
      columns: [t.tenantId, t.guardianId],
      foreignColumns: [t.tenantId, t.id],
    }),
  ],
);

// ─── Audit log (append-only for the app) ────────────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id"), // null = system
    action: text("action").notNull(), // e.g. "patient.update"
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
    // "What happened to this appointment / note / patient?"
    index("audit_logs_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);

/** Tables protected by tenant RLS. Keep in sync with db/rls.sql (a test checks this). */
export const TENANT_TABLES = [
  "branches",
  "departments",
  "tenant_members",
  "rooms",
  "devices",
  "services",
  "staff_schedules",
  "patients",
  "audit_logs",
  "tenant_settings",
  "branch_holidays",
  "patient_medical_flags",
  "appointments",
  "time_blocks",
  "reservations",
  "reschedule_requests",
  "package_templates",
  "patient_packages",
  "package_payments",
  "package_session_events",
  "files",
  "consent_templates",
  "patient_consents",
  "clinical_notes",
  "clinical_note_addenda",
  "verification_codes",
  "rate_limit_hits",
  "patient_sessions",
  "push_subscriptions",
  "notification_prefs",
  "conversations",
  "messages",
  "message_templates",
  "message_dispatches",
  "webhook_events",
  "push_log",
  "consent_rules",
  "concern_events",
  "schedule_exceptions",
  "platform_statements",
  "platform_payments",
  "support_grants",
  "service_practitioners",
  "care_team",
  "billing_items",
  "visit_charges",
  "visit_orders",
  "visit_checkouts",
  "dental_chart_entries",
  "dental_plan_items",
  "lab_cases",
  "membership_plans",
  "patient_memberships",
  "membership_payments",
  "membership_visits",
  "lab_reports",
  "lab_values",
  "lab_requests",
  "clinical_photos",
] as const;

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — clinic workflow
// ════════════════════════════════════════════════════════════════════════════

/** What the clinic writes for its public website (Settings → Website). All optional. */
/** A doctor's public profile on the clinic website. Only real details the clinic enters. */
export interface MemberProfile {
  specialtyAr?: string;
  specialtyEn?: string;
  credentials?: { ar: string; en: string }[];
  languages?: { ar: string; en: string }[];
}

export interface SiteContent {
  headlineAr?: string;
  headlineEn?: string;
  taglineAr?: string;
  taglineEn?: string;
  aboutAr?: string;
  aboutEn?: string;
  /** Short editorial headline over the About text ("About Derma Clinics"). */
  aboutTitleAr?: string;
  aboutTitleEn?: string;
  /** A line from the practice's philosophy, set as a pull quote (never attributed to a person). */
  quoteAr?: string;
  quoteEn?: string;
  /** Year the clinic opened (e.g. 1996). */
  since?: number;
  phone?: string;
  whatsapp?: string;
  instagram?: string;
  /** Ministry of Health licence number, shown only when filled in. */
  licence?: string;
  x?: string;
  tiktok?: string;
  /** Short line above the hero headline, e.g. the clinic's motto. */
  eyebrowAr?: string;
  eyebrowEn?: string;
  /** One-line description in the footer. */
  footerAr?: string;
  footerEn?: string;
  /** Departments (top level), each grouping specialty keys from `specialties`. */
  departments?: {
    key: string;
    nameAr: string;
    nameEn: string;
    textAr?: string;
    textEn?: string;
    specialties: string[];
  }[];
  /** Real photos per website slot (see src/lib/site/images.ts): slot → URL. */
  images?: Record<string, string>;
  /** Intro texts of the website sections, in the clinic's own words. */
  clinicsAr?: string;
  clinicsEn?: string;
  doctorsAr?: string;
  doctorsEn?: string;
  findAr?: string;
  findEn?: string;
  /** Procedures grouped for browsing (laser, injectables, …), per department. */
  silos?: {
    key: string;
    dept: string;
    nameAr: string;
    nameEn: string;
    items: { ar: string; en: string }[];
  }[];
  /** The medical team as the clinic publishes it (name, title, photo). */
  doctors?: {
    nameAr: string;
    nameEn: string;
    titleAr: string;
    titleEn: string;
    dept: string;
    branchAr?: string;
    branchEn?: string;
    photo: string;
    /** Clean portrait (plain background); the published photo is used when missing. */
    portrait?: string;
    founder?: boolean;
    bioAr?: string;
    bioEn?: string;
    /** The doctor's account in this system, when they take online bookings here. */
    memberId?: string;
  }[];
  /** Partner / corporate logos the clinic shows. */
  partners?: { nameAr: string; nameEn: string; logo: string }[];
  /** Real patient reviews the clinic has permission to show. */
  reviews?: { quote: string; name: string; treatment?: string }[];
  /** Real accreditations / licences / memberships, shown only when filled in. */
  credentials?: { ar: string; en: string }[];
  /**
   * The clinic's specialties as presented on its website (its own wording). `bookable`: patients
   * can book it online here; otherwise the website offers WhatsApp / phone.
   */
  specialties?: {
    key: string;
    nameAr: string;
    nameEn: string;
    textAr: string;
    textEn: string;
    /** A short headline for the specialty's chapter ("Skin, read closely."). */
    leadAr?: string;
    leadEn?: string;
    items?: { ar: string; en: string }[];
    bookable?: boolean;
  }[];
}

/** One row per clinic. */
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** ON: doctors move their own appointments. OFF: doctors send requests reception approves. */
  doctorsManageOwnSchedule: boolean("doctors_manage_own_schedule").notNull().default(false),
  /** ON: doctors set their own working days and hours (admins and reception always can). */
  doctorsEditOwnHours: boolean("doctors_edit_own_hours").notNull().default(true),
  slotMinutes: smallint("slot_minutes").notNull().default(15),
  /** Demo clinics: the day the demo week is centred on ("Refresh demo week" moves it to today). */
  demoAnchorDay: date("demo_anchor_day"),

  // ── Online booking (/book) and patient page (/my) ──
  onlineBookingEnabled: boolean("online_booking_enabled").notNull().default(false),
  /** How far ahead patients may book online. */
  onlineHorizonDays: smallint("online_horizon_days").notNull().default(30),
  /** Minimum notice for an online booking, in minutes. */
  onlineMinNoticeMinutes: smallint("online_min_notice_minutes").notNull().default(120),
  /** Patients may cancel/reschedule online until this many hours before the visit. */
  cancellationWindowHours: smallint("cancellation_window_hours").notNull().default(24),
  /** ON: online bookings start as "pending" until reception approves. */
  onlineRequiresApproval: boolean("online_requires_approval").notNull().default(false),
  showPricesOnline: boolean("show_prices_online").notNull().default(true),
  /** WhatsApp: name the service in confirmations, reminders and recalls (off → "your appointment"). */
  showServiceInMessages: boolean("show_service_in_messages").notNull().default(true),
  // ── AI receptionist (WhatsApp) ──
  /** ON: free-text WhatsApp messages are answered by the AI receptionist (needs ANTHROPIC_API_KEY). */
  aiReceptionistEnabled: boolean("ai_receptionist_enabled").notNull().default(false),
  /** Most AI replies per day (Riyadh); beyond it, messages go to the inbox as before. */
  aiDailyLimit: smallint("ai_daily_limit").notNull().default(200),
  /** ON: doctors can dictate and get an AI-drafted clinical note to review and sign. */
  aiScribeEnabled: boolean("ai_scribe_enabled").notNull().default(false),
  /** The clinic's public website (the clinic's address, for visitors): texts and contact details. */
  site: jsonb("site").$type<SiteContent>().notNull().default({}),
  /** When Meta last verified our webhook (WhatsApp status page). */
  whatsappWebhookVerifiedAt: timestamp("whatsapp_webhook_verified_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

/** Days a branch (or the whole clinic, when branch_id is null) is closed. */
export const branchHolidays = pgTable(
  "branch_holidays",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id"), // null = all branches
    day: date("day").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "branch_holidays_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete("cascade"),
  ],
);

// ─── Medical alerts (shown as a warning badge everywhere the patient appears) ─

export const patientMedicalFlags = pgTable(
  "patient_medical_flags",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    kind: medicalFlagKind("kind").notNull(),
    label: text("label").notNull(), // e.g. "Lidocaine" / "ليدوكايين"
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("patient_medical_flags_patient_idx").on(t.tenantId, t.patientId),
    foreignKey({
      name: "patient_medical_flags_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
  ],
);

// ─── Booking ────────────────────────────────────────────────────────────────

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    practitionerId: uuid("practitioner_id").notNull(), // tenant_members.id
    roomId: uuid("room_id").notNull(),
    deviceId: uuid("device_id"), // when the service needs a device
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(), // start + duration
    /** end + buffer: the doctor, room and device stay reserved until then. */
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("booked"),
    receptionNote: text("reception_note"),
    source: bookingSource("source").notNull().default("reception"),
    /** Demo data only: working-day number relative to tenant_settings.demo_anchor_day. */
    demoDayIndex: smallint("demo_day_index"),
    cancelReason: text("cancel_reason"),
    /** Patient flow (reception board): when each step happened. Set by the booking engine. */
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    inRoomAt: timestamp("in_room_at", { withTimezone: true }),
    /** The doctor is with the patient (started the visit, or the nurse said "ready for doctor"). */
    doctorAt: timestamp("doctor_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Anti-spam: one pending (online) booking per patient per slot.
    uniqueIndex("appointments_one_pending_per_slot")
      .on(t.tenantId, t.patientId, t.startsAt)
      .where(sql`${t.status} = 'pending'`),
    unique("appointments_tenant_id_id_key").on(t.tenantId, t.id),
    index("appointments_branch_start_idx").on(t.tenantId, t.branchId, t.startsAt),
    index("appointments_practitioner_start_idx").on(t.tenantId, t.practitionerId, t.startsAt),
    index("appointments_patient_idx").on(t.tenantId, t.patientId),
    // Clinic-wide time windows (WhatsApp reminders, pending approvals) without a branch filter.
    index("appointments_status_start_idx").on(t.tenantId, t.status, t.startsAt),
    check(
      "appointments_times",
      sql`${t.startsAt} < ${t.endsAt} and ${t.endsAt} <= ${t.blockedUntil}`,
    ),
    foreignKey({
      name: "appointments_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    foreignKey({
      name: "appointments_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    foreignKey({
      name: "appointments_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
    foreignKey({
      name: "appointments_practitioner_fk",
      columns: [t.tenantId, t.practitionerId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.id],
    }),
    foreignKey({
      name: "appointments_room_fk",
      columns: [t.tenantId, t.branchId, t.roomId],
      foreignColumns: [rooms.tenantId, rooms.branchId, rooms.id],
    }),
    foreignKey({
      name: "appointments_device_fk",
      columns: [t.tenantId, t.branchId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.branchId, devices.id],
    }),
  ],
);

/** Blocked time for a doctor, room or device (break, leave, maintenance). */
export const timeBlocks = pgTable(
  "time_blocks",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull(),
    memberId: uuid("member_id"),
    roomId: uuid("room_id"),
    deviceId: uuid("device_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    demoDayIndex: smallint("demo_day_index"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("time_blocks_tenant_id_id_key").on(t.tenantId, t.id),
    check("time_blocks_times", sql`${t.startsAt} < ${t.endsAt}`),
    check(
      "time_blocks_one_resource",
      sql`num_nonnulls(${t.memberId}, ${t.roomId}, ${t.deviceId}) = 1`,
    ),
    foreignKey({
      name: "time_blocks_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "time_blocks_member_fk",
      columns: [t.tenantId, t.memberId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "time_blocks_room_fk",
      columns: [t.tenantId, t.branchId, t.roomId],
      foreignColumns: [rooms.tenantId, rooms.branchId, rooms.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "time_blocks_device_fk",
      columns: [t.tenantId, t.branchId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.branchId, devices.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Who/what is busy when. Maintained ONLY by database triggers on appointments and
 * time_blocks (db/booking.sql). An exclusion constraint forbids two overlapping rows for
 * the same doctor, room or device — so double-booking is impossible, even under races.
 */
export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull(),
    resourceKind: text("resource_kind").notNull(), // 'practitioner' | 'room' | 'device'
    resourceId: uuid("resource_id").notNull(),
    during: tstzrange("during").notNull(),
    appointmentId: uuid("appointment_id"),
    timeBlockId: uuid("time_block_id"),
  },
  (t) => [
    check("reservations_kind", sql`${t.resourceKind} in ('practitioner', 'room', 'device')`),
    check("reservations_source", sql`num_nonnulls(${t.appointmentId}, ${t.timeBlockId}) = 1`),
    foreignKey({
      name: "reservations_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reservations_time_block_fk",
      columns: [t.tenantId, t.timeBlockId],
      foreignColumns: [timeBlocks.tenantId, timeBlocks.id],
    }).onDelete("cascade"),
  ],
);

/** A doctor asking reception to move an appointment (when doctors don't manage their own schedule). */
export const rescheduleRequests = pgTable(
  "reschedule_requests",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    proposedStartsAt: timestamp("proposed_starts_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    status: requestStatus("status").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "reschedule_requests_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reschedule_requests_branch_fk",
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
  ],
);

// ─── Packages and session balances ──────────────────────────────────────────

export const packageTemplates = pgTable(
  "package_templates",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    sessionsCount: smallint("sessions_count").notNull(),
    priceHalalas: integer("price_halalas").notNull(),
    validityDays: smallint("validity_days").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("package_templates_tenant_id_id_key").on(t.tenantId, t.id),
    check(
      "package_templates_values",
      sql`${t.sessionsCount} > 0 and ${t.priceHalalas} >= 0 and ${t.validityDays} > 0`,
    ),
    foreignKey({
      name: "package_templates_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
  ],
);

export const patientPackages = pgTable(
  "patient_packages",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    templateId: uuid("template_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    sessionsTotal: smallint("sessions_total").notNull(),
    /** Maintained by a trigger from package_session_events; can never exceed the total or go below 0. */
    sessionsUsed: smallint("sessions_used").notNull().default(0),
    priceHalalas: integer("price_halalas").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    soldBy: text("sold_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("patient_packages_tenant_id_id_key").on(t.tenantId, t.id),
    index("patient_packages_patient_idx").on(t.tenantId, t.patientId),
    check(
      "patient_packages_balance",
      sql`${t.sessionsUsed} >= 0 and ${t.sessionsUsed} <= ${t.sessionsTotal}`,
    ),
    check("patient_packages_price", sql`${t.priceHalalas} >= 0 and ${t.sessionsTotal} > 0`),
    foreignKey({
      name: "patient_packages_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    foreignKey({
      name: "patient_packages_template_fk",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [packageTemplates.tenantId, packageTemplates.id],
    }),
    foreignKey({
      name: "patient_packages_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
  ],
);

export const packagePayments = pgTable(
  "package_payments",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientPackageId: uuid("patient_package_id").notNull(),
    amountHalalas: integer("amount_halalas").notNull(),
    method: paymentMethod("method").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    recordedBy: text("recorded_by"),
    createdAt: createdAt(),
  },
  (t) => [
    check("package_payments_positive", sql`${t.amountHalalas} > 0`),
    foreignKey({
      name: "package_payments_package_fk",
      columns: [t.tenantId, t.patientPackageId],
      foreignColumns: [patientPackages.tenantId, patientPackages.id],
    }),
  ],
);

/** Every change to a package balance. delta = sessions used (+1 at check-in, -1 to give one back). */
export const packageSessionEvents = pgTable(
  "package_session_events",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientPackageId: uuid("patient_package_id").notNull(),
    appointmentId: uuid("appointment_id"),
    kind: sessionEventKind("kind").notNull(),
    delta: smallint("delta").notNull(),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    // Idempotency: one automatic deduction per appointment, ever.
    uniqueIndex("package_session_events_one_deduction")
      .on(t.tenantId, t.appointmentId)
      .where(sql`${t.kind} = 'deduction'`),
    check("package_session_events_delta", sql`${t.delta} <> 0`),
    check(
      "package_session_events_rules",
      sql`(${t.kind} = 'deduction' and ${t.delta} = 1 and ${t.appointmentId} is not null) or (${t.kind} = 'override' and length(btrim(coalesce(${t.reason}, ''))) >= 3)`,
    ),
    foreignKey({
      name: "package_session_events_package_fk",
      columns: [t.tenantId, t.patientPackageId],
      foreignColumns: [patientPackages.tenantId, patientPackages.id],
    }),
    foreignKey({
      name: "package_session_events_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
  ],
);

// ─── Files (FileStore, demo: Postgres) ──────────────────────────────────────

export const files = pgTable(
  "files",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // e.g. "signature"
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [unique("files_tenant_id_id_key").on(t.tenantId, t.id)],
);

// ─── Consents ───────────────────────────────────────────────────────────────

/** Versioned. Editing creates a new version; old versions never change (trigger). */
export const consentTemplates = pgTable(
  "consent_templates",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // e.g. "laser_hair_removal"
    version: integer("version").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    bodyAr: text("body_ar").notNull(),
    bodyEn: text("body_en").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("consent_templates_tenant_id_id_key").on(t.tenantId, t.id),
    unique("consent_templates_version_key").on(t.tenantId, t.code, t.version),
    uniqueIndex("consent_templates_one_current")
      .on(t.tenantId, t.code)
      .where(sql`${t.isCurrent}`),
  ],
);

/** When a consent template needs a NEW signature. One row per template code; no row = every visit. */
export const CONSENT_RULES = ["every_visit", "per_package", "months", "template_change"] as const;
export type ConsentRule = (typeof CONSENT_RULES)[number];

export const consentRules = pgTable(
  "consent_rules",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // consent template code, e.g. "injectables"
    rule: text("rule").$type<ConsentRule>().notNull().default("every_visit"),
    /** Only for "months": how long a signature stays valid. */
    months: integer("months"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("consent_rules_tenant_id_id_key").on(t.tenantId, t.id),
    unique("consent_rules_code_key").on(t.tenantId, t.code),
    check(
      "consent_rules_rule",
      sql`${t.rule} in ('every_visit', 'per_package', 'months', 'template_change')`,
    ),
    check(
      "consent_rules_months",
      sql`(${t.rule} = 'months' and ${t.months} between 1 and 120) or (${t.rule} <> 'months' and ${t.months} is null)`,
    ),
  ],
);

/**
 * THE OFFICIAL SIGNED CONSENT RECORD. Holds a snapshot of the exact text that was signed,
 * the signature image, who signed, who witnessed, and when. Append-only (no update/delete).
 */
export const patientConsents = pgTable(
  "patient_consents",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    templateId: uuid("template_id").notNull(),
    templateCode: text("template_code").notNull(),
    templateVersion: integer("template_version").notNull(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    bodyAr: text("body_ar").notNull(),
    bodyEn: text("body_en").notNull(),
    /** sha256 of the snapshot text, so any later tampering is detectable. */
    contentSha256: text("content_sha256").notNull(),
    signerName: text("signer_name").notNull(),
    signerRelation: text("signer_relation").notNull().default("self"), // self | guardian
    signatureFileId: uuid("signature_file_id").notNull(),
    /** Staff witness when signed at the clinic; null when the patient signed on the patient page. */
    witnessUserId: text("witness_user_id"),
    signedVia: text("signed_via").notNull().default("clinic"), // clinic | patient_portal
    appointmentId: uuid("appointment_id"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "patient_consents_witness",
      sql`(${t.signedVia} = 'clinic' and ${t.witnessUserId} is not null) or ${t.signedVia} = 'patient_portal'`,
    ),
    index("patient_consents_patient_idx").on(t.tenantId, t.patientId, t.templateCode),
    foreignKey({
      name: "patient_consents_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    foreignKey({
      name: "patient_consents_template_fk",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [consentTemplates.tenantId, consentTemplates.id],
    }),
    foreignKey({
      name: "patient_consents_signature_fk",
      columns: [t.tenantId, t.signatureFileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    foreignKey({
      name: "patient_consents_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
  ],
);

// ─── Clinical notes (practitioners only — enforced by RLS) ──────────────────

export const billingItemKind = pgEnum("billing_item_kind", [
  "product", // e.g. sunscreen sold at checkout
  "consumable", // e.g. botox units, filler syringe
  "procedure", // an extra procedure not booked as a service
  "other",
]);

/**
 * Price list (Setup → Price list): what can be put on a visit's invoice besides the booked
 * service — products, consumables, extra procedures. Each has the code the clinic's invoicing
 * system knows it by. Never deleted (switched off).
 */
export const billingItems = pgTable(
  "billing_items",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    kind: billingItemKind("kind").notNull().default("other"),
    priceHalalas: integer("price_halalas").notNull().default(0),
    /** e.g. "unit", "syringe", "ml" (display only). */
    unitAr: text("unit_ar"),
    unitEn: text("unit_en"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("billing_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("billing_items_code_key").on(t.tenantId, t.code),
    check("billing_items_price", sql`${t.priceHalalas} >= 0`),
  ],
);

/**
 * Invoice codes of a visit (the visit screen; reception's checkout reads them; the daily file
 * for the clinic's invoicing system lists them). A copy of code, name and price at the time,
 * so later price changes don't change past visits. Locked once the visit is posted (database).
 */
export const visitCharges = pgTable(
  "visit_charges",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    serviceId: uuid("service_id"),
    billingItemId: uuid("billing_item_id"),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceHalalas: integer("unit_price_halalas").notNull(),
    /** A package session pays for it (the booked service, deducted at check-in): amount 0. */
    coveredByPackage: boolean("covered_by_package").notNull().default(false),
    /** An included membership visit (also at 0). */
    coveredByMembership: boolean("covered_by_membership").notNull().default(false),
    addedByUserId: text("added_by_user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("visit_charges_tenant_id_id_key").on(t.tenantId, t.id),
    index("visit_charges_appointment_idx").on(t.tenantId, t.appointmentId),
    check("visit_charges_quantity", sql`${t.quantity} between 1 and 1000`),
    check("visit_charges_price", sql`${t.unitPriceHalalas} >= 0`),
    check("visit_charges_source", sql`(${t.serviceId} is null) <> (${t.billingItemId} is null)`),
    foreignKey({
      name: "visit_charges_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visit_charges_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    foreignKey({
      name: "visit_charges_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
    foreignKey({
      name: "visit_charges_item_fk",
      columns: [t.tenantId, t.billingItemId],
      foreignColumns: [billingItems.tenantId, billingItems.id],
    }),
  ],
);

export const visitOrderKind = pgEnum("visit_order_kind", ["medication", "treatment"]);

/**
 * The doctor's orders for a visit: medications (name, dose, how often, how long) and a treatment
 * plan (e.g. 5 more laser sessions every 4 weeks). Clinic instructions for the patient — NOT an
 * official e-prescription. Locked once the visit is posted (database).
 */
export const visitOrders = pgTable(
  "visit_orders",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    kind: visitOrderKind("kind").notNull(),
    name: text("name").notNull(),
    dose: text("dose"),
    frequency: text("frequency"),
    duration: text("duration"),
    /** Treatment plan: how many more sessions, how many weeks apart. */
    sessions: integer("sessions"),
    intervalWeeks: integer("interval_weeks"),
    /** A service to book the sessions with (reception's checkout). */
    serviceId: uuid("service_id"),
    instructions: text("instructions"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("visit_orders_tenant_id_id_key").on(t.tenantId, t.id),
    index("visit_orders_appointment_idx").on(t.tenantId, t.appointmentId),
    index("visit_orders_patient_idx").on(t.tenantId, t.patientId),
    check("visit_orders_sessions", sql`${t.sessions} is null or ${t.sessions} between 1 and 50`),
    check(
      "visit_orders_interval",
      sql`${t.intervalWeeks} is null or ${t.intervalWeeks} between 1 and 104`,
    ),
    foreignKey({
      name: "visit_orders_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visit_orders_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    foreignKey({
      name: "visit_orders_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
  ],
);

/**
 * Reception's checkout of a posted visit: what was due, what the patient paid, how, and the
 * number of the invoice in the clinic's own (ZATCA) system. One per visit; append-only.
 */
export const visitCheckouts = pgTable(
  "visit_checkouts",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    /** The visit's invoice lines not covered by a package, at the copied prices. */
    dueHalalas: integer("due_halalas").notNull(),
    /** Membership discount already taken off due_halalas. */
    discountHalalas: integer("discount_halalas").notNull().default(0),
    paidHalalas: integer("paid_halalas").notNull(),
    method: paymentMethod("method"),
    invoiceNumber: text("invoice_number"),
    note: text("note"),
    checkedOutByUserId: text("checked_out_by_user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("visit_checkouts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("visit_checkouts_one_per_visit").on(t.tenantId, t.appointmentId),
    index("visit_checkouts_created_idx").on(t.tenantId, t.createdAt),
    check(
      "visit_checkouts_amounts",
      sql`${t.dueHalalas} >= 0 and ${t.discountHalalas} >= 0 and ${t.paidHalalas} >= 0 and (${t.paidHalalas} = 0 or ${t.method} is not null)`,
    ),
    foreignKey({
      name: "visit_checkouts_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visit_checkouts_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
  ],
);

export const clinicalNotes = pgTable(
  "clinical_notes",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    appointmentId: uuid("appointment_id"),
    authorUserId: text("author_user_id").notNull(),
    authorName: text("author_name").notNull(),
    body: text("body").notNull().default(""),
    status: noteStatus("status").notNull().default("draft"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** The AI scribe drafted (part of) this note: shown as "AI draft — review before signing". */
    aiDraftedAt: timestamp("ai_drafted_at", { withTimezone: true }),
    /**
     * Who typed it, when not the author: a nurse / assistant preparing the doctor's note on the
     * room PC ("entered by Nurse Huda for Dr. Lina"). The doctor stays the author.
     */
    enteredByUserId: text("entered_by_user_id"),
    enteredByName: text("entered_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("clinical_notes_tenant_id_id_key").on(t.tenantId, t.id),
    index("clinical_notes_patient_idx").on(t.tenantId, t.patientId),
    // A doctor's own drafts ("My drafts") and the visit screen's note.
    index("clinical_notes_author_status_idx").on(t.tenantId, t.authorUserId, t.status),
    index("clinical_notes_appointment_idx").on(t.tenantId, t.appointmentId),
    check("clinical_notes_signed", sql`(${t.status} = 'signed') = (${t.signedAt} is not null)`),
    foreignKey({
      name: "clinical_notes_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    foreignKey({
      name: "clinical_notes_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
  ],
);

export const clinicalNoteAddenda = pgTable(
  "clinical_note_addenda",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    noteId: uuid("note_id").notNull(),
    authorUserId: text("author_user_id").notNull(),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("clinical_note_addenda_body", sql`length(btrim(${t.body})) > 0`),
    foreignKey({
      name: "clinical_note_addenda_note_fk",
      columns: [t.tenantId, t.noteId],
      foreignColumns: [clinicalNotes.tenantId, clinicalNotes.id],
    }),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2a — online booking, patient page, push notifications
// ════════════════════════════════════════════════════════════════════════════

/** One-time verification codes (sent through MessageSender). Only a hash is stored. */
export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    purpose: text("purpose").notNull(), // "booking" | "portal"
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: smallint("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("verification_codes_phone_idx").on(t.tenantId, t.phone, t.createdAt),
    check("verification_codes_purpose", sql`${t.purpose} in ('booking', 'portal')`),
  ],
);

/** Rate limiting that works across all Vercel instances: one row per attempt, counted per window. */
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(), // e.g. "otp:phone:0500010001", "otp:ip:1.2.3.4"
    createdAt: createdAt(),
  },
  (t) => [index("rate_limit_hits_bucket_idx").on(t.tenantId, t.bucket, t.createdAt)],
);

/** Patient sessions for /my — separate from staff logins, short-lived. Only a hash of the token is stored. */
export const patientSessions = pgTable(
  "patient_sessions",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "patient_sessions_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
  ],
);

/** Web Push subscriptions (one per staff device). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [unique("push_subscriptions_endpoint_key").on(t.tenantId, t.endpoint)],
);

/** Each staff member's notification choices (per clinic). */
export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    /** Notification types switched OFF (everything else is on). */
    mutedTypes: text("muted_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: updatedAt(),
  },
  (t) => [unique("notification_prefs_user_key").on(t.tenantId, t.userId)],
);

/** Tables a signed-in PATIENT may read (only their own / family rows). Everything else is hidden. */
export const PATIENT_READABLE_TABLES = [
  "patients",
  "appointments",
  "patient_packages",
  "patient_consents",
  "branches",
  "departments",
  "services",
  "rooms",
  "tenant_members",
  "consent_templates",
  "consent_rules",
  "tenant_settings",
] as const;

/** Tables with appointment-like rows that belong to one branch: hidden from staff of other branches. */
export const BRANCH_SCOPED_TABLES = [
  "appointments",
  "time_blocks",
  "reservations",
  "reschedule_requests",
] as const;

/** Readable and writable only with the practitioner role (database-enforced). */
export const PRACTITIONER_ONLY_TABLES = ["clinical_notes", "clinical_note_addenda"] as const;

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2b — WhatsApp messaging
// ════════════════════════════════════════════════════════════════════════════

/**
 * One WhatsApp chat per phone number in a clinic. The patient may be unknown ("not a patient yet"):
 * reception links the number to a patient later. A family sharing a number has one chat.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(), // 05XXXXXXXX
    patientId: uuid("patient_id"),
    /** Name from the person's WhatsApp profile (for numbers that aren't a patient yet). */
    profileName: text("profile_name"),
    /** Reception should answer (free text, a concern, a new contact). */
    needsReply: boolean("needs_reply").notNull().default(false),
    /** Last message FROM the person: free replies are allowed for 24 hours after it. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    /** STOP from a number that isn't a patient yet. */
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    /** Staff took over this chat: the AI receptionist stays quiet until they let it answer again. */
    aiPausedAt: timestamp("ai_paused_at", { withTimezone: true }),
    /**
     * A booking / cancellation / move the AI offered and is waiting for the patient's "yes" to.
     * It is only carried out after a NEWER message from the patient (src/lib/ai/receptionist.ts).
     */
    aiPendingAction: jsonb("ai_pending_action").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("conversations_tenant_phone_key").on(t.tenantId, t.phone),
    index("conversations_inbox_idx").on(t.tenantId, t.needsReply, t.lastMessageAt),
    foreignKey({
      name: "conversations_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("set null"),
  ],
);

/** Every WhatsApp message, in and out (also the demo simulator's). */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    /** The patient the message is about (may be a child in a family chat). */
    patientId: uuid("patient_id"),
    appointmentId: uuid("appointment_id"),
    direction: text("direction").notNull(), // in | out
    /** Message type, e.g. booking_confirmation, reminder, inbound_text, staff_reply. */
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    /** Reply buttons [{id, title}] (outgoing) or the tapped button id (incoming, in buttonId). */
    buttons: jsonb("buttons").$type<{ id: string; title: string }[]>(),
    buttonId: text("button_id"),
    channel: text("channel").notNull(), // demo | meta
    /** queued | sent | delivered | read | failed | received */
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    errorCode: text("error_code"),
    errorText: text("error_text"),
    templateName: text("template_name"),
    language: text("language"),
    /** Marked for reception, e.g. "concern" after a post-care check-in. */
    flag: text("flag"),
    /** A photo the patient sent (stored through the FileStore). Clinical: doctors and admins only. */
    fileId: uuid("file_id"),
    sentBy: text("sent_by"), // staff user for replies; null = system / patient
    createdAt: createdAt(),
    statusAt: timestamp("status_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("messages_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("messages_provider_id_key")
      .on(t.tenantId, t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    index("messages_conversation_idx").on(t.tenantId, t.conversationId, t.createdAt),
    index("messages_appointment_idx").on(t.tenantId, t.appointmentId),
    // Photos a patient sent (visit screen), a patient's WhatsApp history.
    index("messages_patient_idx").on(t.tenantId, t.patientId, t.createdAt),
    check("messages_direction", sql`${t.direction} in ('in', 'out')`),
    check(
      "messages_status",
      sql`${t.status} in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')`,
    ),
    foreignKey({
      name: "messages_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "messages_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("set null"),
    foreignKey({
      name: "messages_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }).onDelete("set null"),
    foreignKey({
      name: "messages_file_fk",
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
  ],
);

/**
 * What staff did about a post-care concern that ISN'T a WhatsApp message: internal notes to
 * reception (never sent to the patient), follow-up booked/requested, resolved. Append-only.
 */
export const concernEvents = pgTable(
  "concern_events",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    /** note | follow_up_request | follow_up | resolved */
    kind: text("kind").notNull(),
    body: text("body"),
    /** follow_up_request (doctor → reception): the suggested service and time. */
    serviceId: uuid("service_id"),
    proposedStartsAt: timestamp("proposed_starts_at", { withTimezone: true }),
    /** follow_up: the booked appointment. */
    followUpAppointmentId: uuid("follow_up_appointment_id"),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("concern_events_tenant_id_id_key").on(t.tenantId, t.id),
    index("concern_events_appointment_idx").on(t.tenantId, t.appointmentId, t.createdAt),
    check(
      "concern_events_kind",
      sql`${t.kind} in ('note', 'follow_up_request', 'follow_up', 'resolved')`,
    ),
    foreignKey({
      name: "concern_events_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
    foreignKey({
      name: "concern_events_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
    foreignKey({
      name: "concern_events_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }),
    foreignKey({
      name: "concern_events_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    foreignKey({
      name: "concern_events_follow_up_fk",
      columns: [t.tenantId, t.followUpAppointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
  ],
);

/** Each message type's switch and wording (Arabic + English) per clinic, plus its Meta template. */
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    bodyAr: text("body_ar").notNull(),
    bodyEn: text("body_en").notNull(),
    /** Name of the approved template at Meta (needed outside the 24-hour window). */
    metaName: text("meta_name").notNull(),
    category: text("category").notNull().default("utility"),
    updatedAt: updatedAt(),
  },
  (t) => [unique("message_templates_kind_key").on(t.tenantId, t.kind)],
);

/**
 * "Already sent" keys: one row per scheduled message (e.g. "reminder:<appointment>"). Inserting the
 * key BEFORE sending, in the same transaction, makes double sends impossible (runs twice, at once).
 */
export const messageDispatches = pgTable(
  "message_dispatches",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull(),
    appointmentId: uuid("appointment_id"),
    patientId: uuid("patient_id"),
    messageId: uuid("message_id"),
    /** sent | skipped (e.g. opted out, type switched off) */
    outcome: text("outcome").notNull().default("sent"),
    createdAt: createdAt(),
  },
  (t) => [unique("message_dispatches_key").on(t.tenantId, t.dedupeKey)],
);

/** Deliveries already handled from Meta's webhook (Meta may deliver the same event again). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("webhook_events_key").on(t.tenantId, t.eventKey)],
);

/**
 * What happened to each staff push notification (admin status page): sent, failed (with the push
 * service's answer), device gone, or why nobody got it (no device, switched off, no keys…).
 */
export const pushLog = pgTable(
  "push_log",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // e.g. patient_concern, new_booking, test
    appointmentId: uuid("appointment_id"),
    /** The staff member it was for (null: nobody, e.g. no recipient at all). */
    userId: text("user_id"),
    /** sent | failed | device_gone | no_device | switched_off | type_muted | no_keys | demo_device | no_recipient */
    outcome: text("outcome").notNull(),
    statusCode: integer("status_code"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("push_log_created_idx").on(t.tenantId, t.createdAt)],
);

// ─── Platform billing (recorded by the platform owner; the clinic admin can read its own) ───

/** A monthly billing statement for a clinic's subscription (not a ZATCA tax invoice). */
export const platformStatements = pgTable(
  "platform_statements",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    amountHalalas: integer("amount_halalas").notNull(),
    vatHalalas: integer("vat_halalas").notNull(),
    totalHalalas: integer("total_halalas").notNull(),
    dueOn: date("due_on").notNull(),
    status: statementStatus("status").notNull().default("issued"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("platform_statements_tenant_id_id_key").on(t.tenantId, t.id),
    unique("platform_statements_number_key").on(t.number),
    // One live statement per clinic and month.
    uniqueIndex("platform_statements_one_per_period")
      .on(t.tenantId, t.periodStart)
      .where(sql`${t.status} <> 'void'`),
    check(
      "platform_statements_amounts",
      sql`${t.amountHalalas} >= 0 and ${t.vatHalalas} >= 0 and ${t.totalHalalas} = ${t.amountHalalas} + ${t.vatHalalas}`,
    ),
  ],
);

/** Money received for a statement (append-only). */
export const platformPayments = pgTable(
  "platform_payments",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id").notNull(),
    amountHalalas: integer("amount_halalas").notNull(),
    method: paymentMethod("method").notNull(),
    reference: text("reference"),
    receivedOn: date("received_on").notNull(),
    recordedBy: text("recorded_by"),
    createdAt: createdAt(),
  },
  (t) => [
    check("platform_payments_positive", sql`${t.amountHalalas} > 0`),
    foreignKey({
      name: "platform_payments_statement_fk",
      columns: [t.tenantId, t.statementId],
      foreignColumns: [platformStatements.tenantId, platformStatements.id],
    }),
  ],
);

// ─── Support access (granted by the clinic, never taken by the platform) ───

/**
 * A clinic admin allows the platform's support to open the clinic for a limited time (view only,
 * or view and change). While it lasts, the platform owner works as a clinic admin (never with
 * clinical notes); every page they open is recorded in the clinic's audit log.
 */
export const supportGrants = pgTable(
  "support_grants",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    grantedBy: text("granted_by").notNull(),
    reason: text("reason"),
    allowChanges: boolean("allow_changes").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    createdAt: createdAt(),
  },
  (t) => [index("support_grants_tenant_expires_idx").on(t.tenantId, t.expiresAt)],
);

// ─── Dental ─────────────────────────────────────────────────────────────────

/** A tooth's state on the dental chart. "healthy" clears what was recorded before. */
export const toothCondition = pgEnum("tooth_condition", [
  "healthy",
  "caries",
  "filled",
  "crown",
  "root_canal",
  "missing",
  "implant",
  "bridge",
  "extraction_needed",
  "watch",
]);

/**
 * The dental chart, as a history: each row is what a dentist (or their nurse) recorded for one
 * tooth (FDI number 11–48) at one moment; the chart shows the latest per tooth. Never edited —
 * a change is a new row. Clinical: only doctors and nurses see it (database policy).
 */
export const dentalChartEntries = pgTable(
  "dental_chart_entries",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    tooth: smallint("tooth").notNull(),
    /** Affected surfaces, any of M O D B L (mesial, occlusal, distal, buccal, lingual). */
    surfaces: text("surfaces").notNull().default(""),
    condition: toothCondition("condition").notNull(),
    note: text("note"),
    appointmentId: uuid("appointment_id"),
    recordedByUserId: text("recorded_by_user_id").notNull(),
    recordedByName: text("recorded_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("dental_chart_entries_tenant_id_id_key").on(t.tenantId, t.id),
    index("dental_chart_entries_patient_idx").on(t.tenantId, t.patientId, t.tooth, t.createdAt),
    check(
      "dental_chart_entries_tooth",
      sql`${t.tooth} between 11 and 48 and ${t.tooth} % 10 between 1 and 8`,
    ),
    check("dental_chart_entries_surfaces", sql`${t.surfaces} ~ '^[MODBL]{0,5}$'`),
    foreignKey({
      name: "dental_chart_entries_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "dental_chart_entries_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
  ],
);

export const dentalPlanStatus = pgEnum("dental_plan_status", ["planned", "done", "cancelled"]);

/**
 * A dental treatment plan across visits: each item is one procedure (a service) on a tooth,
 * with its price copied when planned. "Done" in a visit adds it to that visit's invoice lines.
 * Not clinical notes: reception sees it to book the next steps and to quote the estimate.
 */
export const dentalPlanItems = pgTable(
  "dental_plan_items",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    tooth: smallint("tooth"),
    surfaces: text("surfaces").notNull().default(""),
    serviceId: uuid("service_id").notNull(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    priceHalalas: integer("price_halalas").notNull(),
    status: dentalPlanStatus("status").notNull().default("planned"),
    note: text("note"),
    /** The visit it was done in. */
    appointmentId: uuid("appointment_id"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("dental_plan_items_tenant_id_id_key").on(t.tenantId, t.id),
    index("dental_plan_items_patient_idx").on(t.tenantId, t.patientId, t.createdAt),
    check(
      "dental_plan_items_tooth",
      sql`${t.tooth} is null or (${t.tooth} between 11 and 48 and ${t.tooth} % 10 between 1 and 8)`,
    ),
    check("dental_plan_items_price", sql`${t.priceHalalas} >= 0`),
    check("dental_plan_items_done", sql`(${t.status} = 'done') = (${t.doneAt} is not null)`),
    foreignKey({
      name: "dental_plan_items_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "dental_plan_items_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
    foreignKey({
      name: "dental_plan_items_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
  ],
);

export const labWork = pgEnum("lab_work", [
  "crown",
  "bridge",
  "veneer",
  "denture",
  "aligner",
  "night_guard",
  "implant_part",
  "other",
]);
export const labCaseStatus = pgEnum("lab_case_status", [
  "sent",
  "received",
  "fitted",
  "remake",
  "cancelled",
]);

/**
 * Work sent to a dental lab (crowns, bridges, dentures…): which lab, when it is due back, and
 * where it is now (sent → received → fitted). Reception follows due dates and calls the patient.
 */
export const labCases = pgTable(
  "lab_cases",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    appointmentId: uuid("appointment_id"),
    /** The dentist the work is for. */
    practitionerId: uuid("practitioner_id").notNull(),
    labName: text("lab_name").notNull(),
    work: labWork("work").notNull(),
    teeth: text("teeth").notNull().default(""),
    shade: text("shade"),
    sentOn: date("sent_on").notNull(),
    dueOn: date("due_on").notNull(),
    status: labCaseStatus("status").notNull().default("sent"),
    notes: text("notes"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    fittedAt: timestamp("fitted_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("lab_cases_tenant_id_id_key").on(t.tenantId, t.id),
    index("lab_cases_due_idx").on(t.tenantId, t.status, t.dueOn),
    index("lab_cases_patient_idx").on(t.tenantId, t.patientId),
    check("lab_cases_dates", sql`${t.dueOn} >= ${t.sentOn}`),
    foreignKey({
      name: "lab_cases_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "lab_cases_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
    foreignKey({
      name: "lab_cases_practitioner_fk",
      columns: [t.tenantId, t.practitionerId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.id],
    }),
  ],
);

// ─── Memberships (monthly / yearly plans) ───────────────────────────────────

/**
 * A membership the clinic sells (Clinic set-up → Memberships): a price per period, some
 * included visits of one service per period, and a discount on everything else.
 */
export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    priceHalalas: integer("price_halalas").notNull(),
    /** 1, 3, 6 or 12 months. */
    periodMonths: smallint("period_months").notNull(),
    includedServiceId: uuid("included_service_id"),
    /** Included visits of that service in each period (0 = none). */
    includedVisits: smallint("included_visits").notNull().default(0),
    /** Discount on the other invoice lines of a member's visit, in percent. */
    discountPercent: smallint("discount_percent").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("membership_plans_tenant_id_id_key").on(t.tenantId, t.id),
    check(
      "membership_plans_values",
      sql`${t.priceHalalas} >= 0 and ${t.periodMonths} in (1, 3, 6, 12)
        and ${t.includedVisits} between 0 and 100 and ${t.discountPercent} between 0 and 50
        and ((${t.includedServiceId} is null) = (${t.includedVisits} = 0))`,
    ),
    foreignKey({
      name: "membership_plans_service_fk",
      columns: [t.tenantId, t.includedServiceId],
      foreignColumns: [services.tenantId, services.id],
    }),
  ],
);

/**
 * One period of a patient's membership. The plan's terms are COPIED when sold; a renewal is a
 * new row (renews_id = the period it continues), so the history stays. Only cancelling changes a row.
 */
export const patientMemberships = pgTable(
  "patient_memberships",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    planId: uuid("plan_id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    priceHalalas: integer("price_halalas").notNull(),
    periodMonths: smallint("period_months").notNull(),
    includedServiceId: uuid("included_service_id"),
    includedVisits: smallint("included_visits").notNull().default(0),
    discountPercent: smallint("discount_percent").notNull().default(0),
    /** First and last day (Riyadh), both included. */
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    renewsId: uuid("renews_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByUserId: text("cancelled_by_user_id"),
    soldByUserId: text("sold_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("patient_memberships_tenant_id_id_key").on(t.tenantId, t.id),
    index("patient_memberships_patient_idx").on(t.tenantId, t.patientId, t.endsOn),
    index("patient_memberships_ends_idx").on(t.tenantId, t.endsOn),
    // A period is renewed at most once.
    uniqueIndex("patient_memberships_one_renewal")
      .on(t.tenantId, t.renewsId)
      .where(sql`${t.renewsId} is not null`),
    check(
      "patient_memberships_values",
      sql`${t.endsOn} >= ${t.startsOn} and ${t.priceHalalas} >= 0
        and ${t.includedVisits} between 0 and 100 and ${t.discountPercent} between 0 and 50`,
    ),
    foreignKey({
      name: "patient_memberships_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "patient_memberships_plan_fk",
      columns: [t.tenantId, t.planId],
      foreignColumns: [membershipPlans.tenantId, membershipPlans.id],
    }),
    foreignKey({
      name: "patient_memberships_service_fk",
      columns: [t.tenantId, t.includedServiceId],
      foreignColumns: [services.tenantId, services.id],
    }),
    foreignKey({
      name: "patient_memberships_renews_fk",
      columns: [t.tenantId, t.renewsId],
      foreignColumns: [t.tenantId, t.id],
    }),
  ],
);

/** Money received for a membership period. Append-only. */
export const membershipPayments = pgTable(
  "membership_payments",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientMembershipId: uuid("patient_membership_id").notNull(),
    amountHalalas: integer("amount_halalas").notNull(),
    method: paymentMethod("method").notNull(),
    /** The clinic's own (ZATCA) invoice number. */
    invoiceNumber: text("invoice_number"),
    recordedByUserId: text("recorded_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("membership_payments_created_idx").on(t.tenantId, t.createdAt),
    check("membership_payments_positive", sql`${t.amountHalalas} > 0`),
    foreignKey({
      name: "membership_payments_membership_fk",
      columns: [t.tenantId, t.patientMembershipId],
      foreignColumns: [patientMemberships.tenantId, patientMemberships.id],
    }).onDelete("cascade"),
  ],
);

/** An included visit used at check-in. Append-only; one per appointment, ever. */
export const membershipVisits = pgTable(
  "membership_visits",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientMembershipId: uuid("patient_membership_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("membership_visits_one_per_appointment").on(t.tenantId, t.appointmentId),
    index("membership_visits_membership_idx").on(t.tenantId, t.patientMembershipId),
    foreignKey({
      name: "membership_visits_membership_fk",
      columns: [t.tenantId, t.patientMembershipId],
      foreignColumns: [patientMemberships.tenantId, patientMemberships.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "membership_visits_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }).onDelete("cascade"),
  ],
);

// ─── Lab results (clinical: doctors and nurses only) ────────────────────────

/** How a value compares with its reference range (worked out when it is entered). */
export const labFlag = pgEnum("lab_flag", ["low", "normal", "high", "abnormal", "none"]);

/**
 * One set of results from a lab (blood test, swab, biopsy…), entered by a doctor or nurse, with
 * the lab's report attached when there is one. Never edited: a mistake is voided (with a reason)
 * and entered again, so what a doctor once saw stays on record.
 */
export const labReports = pgTable(
  "lab_reports",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    /** The visit it was entered in, when there was one. */
    appointmentId: uuid("appointment_id"),
    /** The day the sample was taken. */
    takenOn: date("taken_on").notNull(),
    labName: text("lab_name"),
    note: text("note"),
    /** The lab's own report (PDF or photo) in the file store. */
    fileId: uuid("file_id"),
    enteredByUserId: text("entered_by_user_id").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: text("voided_by_user_id"),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("lab_reports_tenant_id_id_key").on(t.tenantId, t.id),
    index("lab_reports_patient_idx").on(t.tenantId, t.patientId, t.takenOn),
    check("lab_reports_void_reason", sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
    foreignKey({
      name: "lab_reports_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "lab_reports_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
    foreignKey({
      name: "lab_reports_file_fk",
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
  ],
);

/** One value in a report (e.g. Ferritin 12 ng/mL, range 30–400 → low). Append-only. */
export const labValues = pgTable(
  "lab_values",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull(),
    position: smallint("position").notNull().default(0),
    testName: text("test_name").notNull(),
    /** As written on the report ("12.4", "Negative", "<0.5"). */
    valueText: text("value_text").notNull(),
    /** The number in it, when there is one (for flags and trends). */
    valueNum: doublePrecision("value_num"),
    unit: text("unit"),
    refLow: doublePrecision("ref_low"),
    refHigh: doublePrecision("ref_high"),
    flag: labFlag("flag").notNull().default("none"),
  },
  (t) => [
    index("lab_values_report_idx").on(t.tenantId, t.reportId),
    foreignKey({
      name: "lab_values_report_fk",
      columns: [t.tenantId, t.reportId],
      foreignColumns: [labReports.tenantId, labReports.id],
    }).onDelete("cascade"),
  ],
);

/** "Repeat this test by …": a request with a due date; done when matching results are entered. */
export const labRequests = pgTable(
  "lab_requests",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    appointmentId: uuid("appointment_id"),
    testName: text("test_name").notNull(),
    dueOn: date("due_on").notNull(),
    reason: text("reason"),
    requestedByUserId: text("requested_by_user_id").notNull(),
    doneReportId: uuid("done_report_id"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("lab_requests_patient_idx").on(t.tenantId, t.patientId, t.dueOn),
    foreignKey({
      name: "lab_requests_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "lab_requests_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
    foreignKey({
      name: "lab_requests_report_fk",
      columns: [t.tenantId, t.doneReportId],
      foreignColumns: [labReports.tenantId, labReports.id],
    }),
  ],
);

// ─── Clinical photos (before / after) ───────────────────────────────────────

/**
 * A clinical photo (before / after): taken by a doctor or nurse, linked to the visit it was taken
 * in. Clinical: doctors, nurses and the clinic admin only (database policy); never patients or
 * reception. Never edited or deleted — a wrong one is voided with a reason.
 */
export const clinicalPhotos = pgTable(
  "clinical_photos",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    appointmentId: uuid("appointment_id"),
    fileId: uuid("file_id").notNull(),
    area: text("area").notNull(),
    view: text("view").notNull(),
    takenOn: date("taken_on").notNull(),
    note: text("note"),
    takenByUserId: text("taken_by_user_id").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: text("voided_by_user_id"),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("clinical_photos_tenant_id_id_key").on(t.tenantId, t.id),
    index("clinical_photos_patient_idx").on(t.tenantId, t.patientId, t.area, t.takenOn),
    check("clinical_photos_void_reason", sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
    check(
      "clinical_photos_area",
      sql.raw(`area in (${PHOTO_AREAS.map((a) => `'${a}'`).join(", ")})`),
    ),
    check(
      "clinical_photos_view",
      sql.raw(`view in (${PHOTO_VIEWS.map((v) => `'${v}'`).join(", ")})`),
    ),
    foreignKey({
      name: "clinical_photos_patient_fk",
      columns: [t.tenantId, t.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "clinical_photos_appointment_fk",
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }),
    foreignKey({
      name: "clinical_photos_file_fk",
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
  ],
);
