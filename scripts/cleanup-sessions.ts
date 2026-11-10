/**
 * Remove orphan session leftovers: temp files, store JSON without an auth
 * directory (file backend) and incomplete md_<id> dirs without creds.json.
 *
 * Usage: bun scripts/cleanup-sessions.ts
 */
import { cleanupOrphanSessionFiles } from "@/baileys/authState/file";

const { removed } = cleanupOrphanSessionFiles();

if (removed.length === 0) {
  console.log("No orphan session files found.");
} else {
  console.log(`Removed ${removed.length} orphan file(s):`);
  for (const name of removed) console.log(` - ${name}`);
}
