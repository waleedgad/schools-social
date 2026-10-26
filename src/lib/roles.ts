export const ROLES = ["admin", "comms", "principal", "teacher"] as const;
export type Role = (typeof ROLES)[number];

// Mirrors the permissions table in the project plan.
const PERMISSIONS = {
  upload: ["admin", "comms", "principal", "teacher"],
  viewLibrary: ["admin", "comms", "principal"],
  manageEvents: ["admin", "comms", "principal"],
  writePosts: ["admin", "comms", "principal"],
  approvePosts: ["admin", "comms", "principal"],
  signOffSensitive: ["admin", "principal"],
  publish: ["admin", "comms", "principal"],
  manageConsent: ["admin", "comms", "principal"],
  manageStaff: ["admin"],
  manageSettings: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
