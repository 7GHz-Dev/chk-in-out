export const ROLES = ["user", "admin", "hr", "employee-driver", "employee-office"] as const;
export type Role = (typeof ROLES)[number];

export function normalizeRole(value: unknown): Role {
  const role = String(value || "user").trim().toLowerCase().replaceAll("_", "-");
  if (role === "employee-shipping" || role === "shipping" || role === "driver") return "employee-driver";
  if (role === "office") return "employee-office";
  return ROLES.includes(role as Role) ? role as Role : "user";
}
