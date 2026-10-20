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
import {
  boolean,
  check,
  customType,
  date,
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

export const memberRole = pgEnum("member_role", ["clinic_admin", "practitioner", "receptionist"]);
export const gender = pgEnum("gender", ["male", "female"]);
export const idType = pgEnum("id_type", ["national_id", "iqama", "passport"]);
export const appointmentStatus = pgEnum("appointment_status", [
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
export const requestStatus = pgEnum("request_status", ["pending", "approved", "rejected"]);

/** Postgres timestamp range, e.g. [10:00, 10:45). Used to forbid overlapping bookings. */
const tstzrange = customType<{ data: string }>({ dataType: () => "tstzrange" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// ─── Clinics ────────────────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: id(),
  slug: text("slug").notNull().unique(), // subdomain, e.g. "derma"
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  brandColor: text("brand_color").notNull().default("#28817a"),
  isDemo: boolean("is_demo").notNull().default(true),
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
    titleAr: text("title_ar"),
    titleEn: text("title_en"),
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
    createdAt: createdAt(),
  },
  (t) => [
    unique("rooms_tenant_id_id_key").on(t.tenantId, t.id),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("patients_tenant_id_id_key").on(t.tenantId, t.id),
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
  (t) => [index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt)],
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
] as const;

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — clinic workflow
// ════════════════════════════════════════════════════════════════════════════

/** One row per clinic. */
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** ON: doctors move their own appointments. OFF: doctors send requests reception approves. */
  doctorsManageOwnSchedule: boolean("doctors_manage_own_schedule").notNull().default(false),
  slotMinutes: smallint("slot_minutes").notNull().default(15),
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
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("appointments_tenant_id_id_key").on(t.tenantId, t.id),
    index("appointments_branch_start_idx").on(t.tenantId, t.branchId, t.startsAt),
    index("appointments_practitioner_start_idx").on(t.tenantId, t.practitionerId, t.startsAt),
    index("appointments_patient_idx").on(t.tenantId, t.patientId),
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
    witnessUserId: text("witness_user_id").notNull(),
    appointmentId: uuid("appointment_id"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("clinical_notes_tenant_id_id_key").on(t.tenantId, t.id),
    index("clinical_notes_patient_idx").on(t.tenantId, t.patientId),
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

/** Tables with appointment-like rows that belong to one branch: hidden from staff of other branches. */
export const BRANCH_SCOPED_TABLES = [
  "appointments",
  "time_blocks",
  "reservations",
  "reschedule_requests",
] as const;

/** Readable and writable only with the practitioner role (database-enforced). */
export const PRACTITIONER_ONLY_TABLES = ["clinical_notes", "clinical_note_addenda"] as const;
