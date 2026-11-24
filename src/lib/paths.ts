// A storage path inside the school's own folder (no ".."). Every place that
// signs photo links with the server key checks this first (B-106, S-21N-03).
export function isOwnPath(schoolId: string, path: string | null | undefined) {
  return !!path && path.startsWith(`${schoolId}/`) && !path.includes("..");
}
