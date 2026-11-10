import { resolve, sep } from "node:path";

/** Separator-aware containment check (a bare startsWith also matches siblings). */
export function isPathInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + sep);
}
