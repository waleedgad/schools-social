// Roles plan (28 Oct 2026). The admin can do everything. Posts are approved
// inside the comms team (by the comms lead, or by any other comms member if
// the school allows it), and optionally by an extra approver, usually the
// principal. Teachers, staff and photographers upload.
export const ROLES = ["admin", "comms_lead", "comms", "principal", "teacher", "staff", "photographer"] as const;
export type Role = (typeof ROLES)[number];

// Roles a school admin can give when inviting someone.
export const INVITE_ROLES: Role[] = ["admin", "comms_lead", "comms", "principal", "teacher", "staff", "photographer"];

// Only these count towards the plan's paid users.
export const PAID_ROLES: Role[] = ["admin", "comms_lead", "comms"];

const COMMS = ["admin", "comms_lead", "comms"] as const;

const PERMISSIONS = {
  upload: ["admin", "comms_lead", "comms", "principal", "teacher", "staff", "photographer"],
  viewLibrary: COMMS,
  manageEvents: COMMS,
  writePosts: COMMS,
  viewPosts: [...COMMS, "principal"],
  approvePosts: ["admin", "comms_lead"],
  extraApprove: ["admin", "principal"],
  publish: ["admin", "comms_lead"],
  urgentPost: ["admin", "comms_lead"],
  manageConsent: COMMS,
  manageCategories: ["admin", "comms_lead"],
  pauseAccounts: ["admin", "comms_lead"],
  viewAnalytics: [...COMMS, "principal"],
  manageStaff: ["admin"],
  manageSettings: ["admin"],
  viewActivity: ["admin", "principal"],
  confirmFaces: ["admin", "comms_lead", "comms", "teacher"],
  viewCoverage: [...COMMS, "principal", "teacher"],
  reviewBooks: [...COMMS, "principal", "teacher"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

// A school can tick or untick single abilities per role. The admin always
// keeps everything, so nobody can lock the school out.
export type PermissionOverrides = Partial<Record<Role, Partial<Record<Permission, boolean>>>>;

export function can(role: Role, permission: Permission, overrides?: PermissionOverrides | null): boolean {
  if (role === "admin") return true;
  const custom = overrides?.[role]?.[permission];
  if (typeof custom === "boolean") return custom;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function defaultCan(role: Role, permission: Permission) {
  return role === "admin" || (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isComms(role: Role) {
  return role === "admin" || role === "comms_lead" || role === "comms";
}
