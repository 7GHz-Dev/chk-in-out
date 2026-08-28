import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  name: text("name").notNull(),
  role: text("role", {
    enum: ["user", "admin", "hr", "employee-driver", "employee-office"],
  }).notNull().default("user"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_users_username_ci").on(sql`lower(${table.username})`),
  index("idx_users_active_role").on(table.active, table.role),
]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [index("idx_sessions_user_expiry").on(table.userId, table.expiresAt)]);

export const attendance = sqliteTable("attendance", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  workDate: text("work_date").notNull(),
  checkInAt: text("check_in_at").notNull(),
  checkInDeviceAt: text("check_in_device_at").notNull().default(""),
  checkInLat: real("check_in_lat").notNull(),
  checkInLng: real("check_in_lng").notNull(),
  checkInAccuracy: real("check_in_accuracy").notNull().default(0),
  checkInPhotoKey: text("check_in_photo_key").notNull(),
  checkOutAt: text("check_out_at"),
  checkOutDeviceAt: text("check_out_device_at"),
  checkOutLat: real("check_out_lat"),
  checkOutLng: real("check_out_lng"),
  checkOutAccuracy: real("check_out_accuracy"),
  checkOutPhotoKey: text("check_out_photo_key"),
}, (table) => [
  uniqueIndex("idx_attendance_user_date").on(table.userId, table.workDate),
  index("idx_attendance_work_date").on(table.workDate),
]);
