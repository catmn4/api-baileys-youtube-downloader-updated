#!/usr/bin/env node
/**
 * Release helper: bump the version, prepend a CHANGELOG entry generated from
 * Conventional Commits since the last tag, commit and create an annotated tag.
 *
 * Usage: node scripts/release.mjs <patch|minor|major> [--dry-run]
 *
 * It never pushes: the printed command is the last manual step.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const kind = args.find((arg) => ["patch", "minor", "major"].includes(arg));
const dryRun = args.includes("--dry-run");

if (!kind) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major> [--dry-run]");
  process.exit(1);
}

const run = (command) => {
  try {
    return execSync(command, { encoding: "utf8" }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Command failed: ${command}\n${detail}`);
  }
};

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (run("git status --porcelain")) {
  fail("Working tree is not clean. Commit or stash your changes first.");
}

let pkg;
try {
  pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch (error) {
  fail(`Cannot read package.json: ${error instanceof Error ? error.message : String(error)}`);
}
const [major, minor, patch] = String(pkg.version).split(".").map(Number);
if ([major, minor, patch].some((part) => Number.isNaN(part))) {
  fail(`Unreadable version in package.json: ${pkg.version}`);
}

let next = `${major}.${minor}.${patch + 1}`;
if (kind === "major") next = `${major + 1}.0.0`;
if (kind === "minor") next = `${major}.${minor + 1}.0`;
const tag = `v${next}`;

let lastTag = "";
try {
  lastTag = run("git describe --tags --abbrev=0");
} catch {
  lastTag = "";
}

const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const subjects = run(`git log ${range} --format=%s`)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const commits = subjects.filter((subject) => !/^chore\(release\):\s*v?\d+\.\d+\.\d+/.test(subject));
if (commits.length === 0) {
  fail(`No commits since ${lastTag || "the beginning"}; nothing to release.`);
}

const groups = { Added: [], Changed: [], Fixed: [], Security: [], Removed: [] };
for (const subject of commits) {
  const match = subject.match(/^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/i);
  const type = (match?.[1] ?? "").toLowerCase();
  const text = match?.[4] ?? subject;
  if (type === "feat") groups.Added.push(text);
  else if (type === "fix" || type === "perf") groups.Fixed.push(text);
  else if (type === "security") groups.Security.push(text);
  else if (type === "revert" && /remove/i.test(text)) groups.Removed.push(text);
  else groups.Changed.push(text);
}

const today = new Date().toLocaleDateString("en-CA");
let entry = `## [${next}] - ${today}\n`;
for (const [heading, items] of Object.entries(groups)) {
  if (items.length === 0) continue;
  entry += `\n### ${heading}\n\n${items.map((item) => `- ${item}`).join("\n")}\n`;
}

const changelogPath = "CHANGELOG.md";
const header = `# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

`;

let changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : header;
if (!changelog.includes("## [Unreleased]")) {
  changelog = `${header}${changelog.replace(/^# .*\n+/, "")}`;
}
changelog = changelog.replace("## [Unreleased]\n", `## [Unreleased]\n\n${entry}`);

if (dryRun) {
  console.log(`Would release ${pkg.version} → ${next} (tag ${tag})`);
  console.log(`Range: ${lastTag || "(no previous tag)"}..HEAD (${commits.length} commits)`);
  console.log("\n--- CHANGELOG entry ---\n");
  console.log(entry);
  process.exit(0);
}

pkg.version = next;
writeFileSync("package.json", `${JSON.stringify(pkg, null, "\t")}\n`);
writeFileSync(changelogPath, changelog);

run("git add package.json CHANGELOG.md");
run(`git commit -m "chore(release): ${next}"`);
run(`git tag -a ${tag} -m "${tag}"`);

console.log(`✓ Released ${next} (tag ${tag})`);
console.log(`\nNext: git push origin HEAD --follow-tags`);
