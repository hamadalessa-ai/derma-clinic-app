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
    isDemoValue: boolean("is_demo_value").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("services_tenant_code_key").on(t.tenantId, t.code),
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
    createdAt: createdAt(),
  },
  (t) => [
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
    isFake: boolean("is_fake").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("patients_tenant_id_id_key").on(t.tenantId, t.id),
    unique("patients_tenant_file_key").on(t.tenantId, t.fileNumber),
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
] as const;
