import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CaseReport {
  arguments: Record<string, unknown>;
  defaultChars: number;
  defaultResults: number;
  limit20Chars: number;
  limit20Results: number;
  connectionChars: number;
  firstCapability?: unknown;
  guideKeepsScopes: boolean;
}

const root = join(import.meta.dirname, "../..");
const baseRef = process.argv[2] ?? "origin/main";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function measure(dir: string): CaseReport[] {
  execFileSync(process.execPath, ["scripts/ensure-generated.ts"], { cwd: dir, stdio: "ignore" });
  const output = execFileSync(process.execPath, ["bench/mcp-token-usage/measure.ts"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(output) as CaseReport[];
}

function label(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
}

function size(chars: number): string {
  return chars.toLocaleString("en-US");
}

function change(before: number, after: number): string {
  return `${Math.round((100 * (after - before)) / before)}%`.replace(/^(\d)/, "+$1");
}

const base = git("merge-base", "HEAD", baseRef);
const worktree = mkdtempSync(join(tmpdir(), "mcp-token-usage-"));
let before: CaseReport[];
try {
  git("worktree", "add", "--detach", worktree, base);
  symlinkSync(join(root, "node_modules"), join(worktree, "node_modules"));
  mkdirSync(join(worktree, "bench/mcp-token-usage"), { recursive: true });
  copyFileSync(join(import.meta.dirname, "measure.ts"), join(worktree, "bench/mcp-token-usage/measure.ts"));
  before = measure(worktree);
} finally {
  git("worktree", "remove", "--force", worktree);
  rmSync(worktree, { recursive: true, force: true });
}
const after = measure(root);

console.log(`search_actions output, in characters of compact structuredContent`);
console.log(`base ${base.slice(0, 8)} (merge-base with ${baseRef})`);
console.log(`head ${git("rev-parse", "--short=8", "HEAD")} (HEAD)`);
console.log(
  `OAuth connections for googledocs, googledrive, and sentry are fixtures granted each provider's default scopes.`,
);
console.log(`No network, credentials, or model are used.\n`);

const rows = before.map((item, index) => {
  const next = after[index]!;
  return [
    `search_actions ${label(item.arguments)}`,
    `${size(item.defaultChars)} (${item.defaultResults})`,
    `${size(next.limit20Chars)} (${next.limit20Results}) ${change(item.defaultChars, next.limit20Chars)}`,
    `${size(next.defaultChars)} (${next.defaultResults}) ${change(item.defaultChars, next.defaultChars)}`,
  ];
});
const header = ["", "base, default limit", "head, limit 20", "head, default limit"];
const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
for (const row of [header, ...rows]) {
  console.log(
    row
      .map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)))
      .join("   "),
  );
}
console.log(`(n) = number of results\n`);

const sample = before[0]!;
const sampleAfter = after[0]!;
console.log(`Why: on base, every result of search_actions ${label(sample.arguments)} repeats the default connection.`);
console.log(
  `capability.connection takes ${size(sample.connectionChars)} of ${size(sample.limit20Chars)} characters ` +
    `(${Math.round((100 * sample.connectionChars) / sample.limit20Chars)}%) across ${sample.limit20Results} results.\n`,
);
console.log(`base capability of the first result:`);
console.log(JSON.stringify(sample.firstCapability, null, 2));
console.log(`\nhead capability of the first result:`);
console.log(JSON.stringify(sampleAfter.firstCapability, null, 2));
console.log(
  `\nget_action_guide still returns requiredScopes and the granted scopes on head: ${after.every((item) => item.guideKeepsScopes) ? "yes" : "no"}`,
);
