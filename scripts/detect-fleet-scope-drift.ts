import fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";

interface FileMapping {
  fsPath: string;
  nexusPath: string;
}

interface DriftResult {
  fsPath: string;
  nexusPath: string;
  category: "modified" | "added" | "deleted" | "unchanged";
  diffLines?: string[];
  linesChanged?: number;
  changeSize?: "Small" | "Medium" | "Large";
  touchesRoutes?: boolean;
  touchesDb?: boolean;
  touchesEnvVars?: boolean;
  fullContent?: string;
}

const FILE_MAPPINGS: FileMapping[] = [
  { fsPath: "shared/schema.ts", nexusPath: "shared/fleet-scope-schema.ts" },
  { fsPath: "server/routes.ts", nexusPath: "server/fleet-scope-routes.ts" },
  { fsPath: "server/storage.ts", nexusPath: "server/fleet-scope-storage.ts" },
  { fsPath: "server/db.ts", nexusPath: "server/fleet-scope-db.ts" },
  { fsPath: "server/snowflake.ts", nexusPath: "server/fleet-scope-snowflake.ts" },
  { fsPath: "server/fleet-finder.ts", nexusPath: "server/fleet-scope-fleet-finder.ts" },
  { fsPath: "server/pmf-api.ts", nexusPath: "server/fleet-scope-pmf-api.ts" },
  { fsPath: "server/samsara.ts", nexusPath: "server/fleet-scope-samsara.ts" },
  { fsPath: "server/reg-messaging.ts", nexusPath: "server/fleet-scope-reg-messaging.ts" },
  { fsPath: "server/reverse-geocode.ts", nexusPath: "server/fleet-scope-reverse-geocode.ts" },
  { fsPath: "server/ups.ts", nexusPath: "server/fleet-scope-ups.ts" },
  { fsPath: "server/distance-calculator.ts", nexusPath: "server/fleet-scope-distance-calculator.ts" },
  { fsPath: "server/fleet-cost-jobs.ts", nexusPath: "server/fleet-scope-fleet-cost-jobs.ts" },
  { fsPath: "client/src/context/UserContext.tsx", nexusPath: "client/src/context/FleetScopeUserContext.tsx" },
];

const PAGE_DIR_FS = "client/src/pages";
const PAGE_DIR_NEXUS = "client/src/pages/fleet-scope";

const COMPONENT_DIR_FS = "client/src/components";
const COMPONENT_DIR_NEXUS = "client/src/components/fleet-scope";

const HOOK_DIR_FS = "client/src/hooks";

const IMPORT_NORMALIZATIONS: Array<{ nexusPattern: RegExp; fsReplacement: string }> = [
  { nexusPattern: /@shared\/fleet-scope-schema/g, fsReplacement: "@shared/schema" },
  { nexusPattern: /\/api\/fs\//g, fsReplacement: "/api/" },
  { nexusPattern: /\.\/fleet-scope-db/g, fsReplacement: "./db" },
  { nexusPattern: /\.\/fleet-scope-storage/g, fsReplacement: "./storage" },
  { nexusPattern: /\.\/fleet-scope-snowflake/g, fsReplacement: "./snowflake" },
  { nexusPattern: /\.\/fleet-scope-routes/g, fsReplacement: "./routes" },
  { nexusPattern: /\.\/fleet-scope-fleet-finder/g, fsReplacement: "./fleet-finder" },
  { nexusPattern: /\.\/fleet-scope-pmf-api/g, fsReplacement: "./pmf-api" },
  { nexusPattern: /\.\/fleet-scope-samsara/g, fsReplacement: "./samsara" },
  { nexusPattern: /\.\/fleet-scope-reg-messaging/g, fsReplacement: "./reg-messaging" },
  { nexusPattern: /\.\/fleet-scope-reverse-geocode/g, fsReplacement: "./reverse-geocode" },
  { nexusPattern: /\.\/fleet-scope-ups/g, fsReplacement: "./ups" },
  { nexusPattern: /\.\/fleet-scope-distance-calculator/g, fsReplacement: "./distance-calculator" },
  { nexusPattern: /\.\/fleet-scope-fleet-cost-jobs/g, fsReplacement: "./fleet-cost-jobs" },
  { nexusPattern: /fleetScopeStorage/g, fsReplacement: "storage" },
  { nexusPattern: /registerFleetScopeRoutes/g, fsReplacement: "registerRoutes" },
  { nexusPattern: /fsDb/g, fsReplacement: "db" },
  { nexusPattern: /fsPool/g, fsReplacement: "pool" },
  { nexusPattern: /FS_DATABASE_URL/g, fsReplacement: "DATABASE_URL" },
  { nexusPattern: /FS_SAMSARA_API_TOKEN/g, fsReplacement: "SAMSARA_API_TOKEN" },
  { nexusPattern: /FS_PMF_CLIENT_ID/g, fsReplacement: "PMF_CLIENT_ID" },
  { nexusPattern: /FS_PMF_CLIENT_SECRET/g, fsReplacement: "PMF_CLIENT_SECRET" },
  { nexusPattern: /FS_TWILIO_ACCOUNT_SID/g, fsReplacement: "TWILIO_ACCOUNT_SID" },
  { nexusPattern: /FS_TWILIO_AUTH_TOKEN/g, fsReplacement: "TWILIO_AUTH_TOKEN" },
  { nexusPattern: /FS_TWILIO_PHONE_NUMBER/g, fsReplacement: "TWILIO_PHONE_NUMBER" },
  { nexusPattern: /FS_ELEVENLABS_API_KEY/g, fsReplacement: "ELEVENLABS_API_KEY" },
  { nexusPattern: /FS_SENDGRID_API_KEY/g, fsReplacement: "SENDGRID_API_KEY" },
  { nexusPattern: /FS_OPENAI_API_KEY/g, fsReplacement: "OPENAI_API_KEY" },
  { nexusPattern: /FS_PUBLIC_SPARES_API_KEY/g, fsReplacement: "PUBLIC_SPARES_API_KEY" },
  { nexusPattern: /FS_BYOV_API_KEY/g, fsReplacement: "BYOV_API_KEY" },
  { nexusPattern: /FS_UPS_CLIENT_ID/g, fsReplacement: "UPS_CLIENT_ID" },
  { nexusPattern: /FS_UPS_API_CLIENT_SECRET/g, fsReplacement: "UPS_API_CLIENT_SECRET" },
  { nexusPattern: /FS_SNOWFLAKE_ACCOUNT/g, fsReplacement: "SNOWFLAKE_ACCOUNT" },
  { nexusPattern: /FS_SNOWFLAKE_USER/g, fsReplacement: "SNOWFLAKE_USER" },
  { nexusPattern: /FS_SNOWFLAKE_DATABASE/g, fsReplacement: "SNOWFLAKE_DATABASE" },
  { nexusPattern: /FS_SNOWFLAKE_SCHEMA/g, fsReplacement: "SNOWFLAKE_SCHEMA" },
  { nexusPattern: /FS_SNOWFLAKE_TABLE/g, fsReplacement: "SNOWFLAKE_TABLE" },
  { nexusPattern: /FS_SNOWFLAKE_PRIVATE_KEY_PATH/g, fsReplacement: "SNOWFLAKE_PRIVATE_KEY_PATH" },
  { nexusPattern: /FS_PGHOST/g, fsReplacement: "PGHOST" },
  { nexusPattern: /FS_PGPORT/g, fsReplacement: "PGPORT" },
  { nexusPattern: /FS_PGUSER/g, fsReplacement: "PGUSER" },
  { nexusPattern: /FS_PGPASSWORD/g, fsReplacement: "PGPASSWORD" },
  { nexusPattern: /FS_PGDATABASE/g, fsReplacement: "PGDATABASE" },
  { nexusPattern: /\/fs-ws/g, fsReplacement: "/ws" },
  { nexusPattern: /FleetScopeUserContext/g, fsReplacement: "UserContext" },
  { nexusPattern: /fleet-scope\//g, fsReplacement: "" },
  { nexusPattern: /getDb\(\)/g, fsReplacement: "db" },
  { nexusPattern: /Fleet-Scope database not configured \(DATABASE_URL missing\)/g, fsReplacement: "Database not configured" },
  { nexusPattern: /\[Fleet-Scope\] /g, fsReplacement: "" },
];

function normalizeNexusContent(content: string): string {
  let normalized = content;
  for (const rule of IMPORT_NORMALIZATIONS) {
    normalized = normalized.replace(rule.nexusPattern, rule.fsReplacement);
  }
  return normalized;
}

function computeUnifiedDiff(aLines: string[], bLines: string[], aLabel: string, bLabel: string): string[] {
  const result: string[] = [];
  result.push(`--- ${aLabel}`);
  result.push(`+++ ${bLabel}`);

  const n = aLines.length;
  const m = bLines.length;

  const MAX = n + m;
  if (MAX > 50000) {
    result.push("@@ File too large for inline diff @@");
    result.push(`- ${n} lines (Nexus normalized)`);
    result.push(`+ ${m} lines (Fleet-Scope source)`);
    return result;
  }

  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    dp[i] = new Array(m + 1).fill(0);
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  interface Hunk {
    aStart: number;
    bStart: number;
    lines: string[];
  }

  const rawChanges: Array<{ type: "equal" | "del" | "add"; aIdx: number; bIdx: number; line: string }> = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && aLines[i] === bLines[j]) {
      rawChanges.push({ type: "equal", aIdx: i, bIdx: j, line: aLines[i] });
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      rawChanges.push({ type: "add", aIdx: i, bIdx: j, line: bLines[j] });
      j++;
    } else {
      rawChanges.push({ type: "del", aIdx: i, bIdx: j, line: aLines[i] });
      i++;
    }
  }

  const CONTEXT = 3;
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let lastChangeIdx = -100;

  for (let idx = 0; idx < rawChanges.length; idx++) {
    const ch = rawChanges[idx];
    if (ch.type !== "equal") {
      const contextStart = Math.max(0, idx - CONTEXT);
      if (!currentHunk || idx - lastChangeIdx > CONTEXT * 2 + 1) {
        if (currentHunk) {
          for (let c = lastChangeIdx + 1; c < Math.min(lastChangeIdx + CONTEXT + 1, rawChanges.length); c++) {
            if (rawChanges[c].type === "equal") {
              currentHunk.lines.push(` ${rawChanges[c].line}`);
            }
          }
          hunks.push(currentHunk);
        }
        currentHunk = { aStart: ch.aIdx, bStart: ch.bIdx, lines: [] };
        for (let c = contextStart; c < idx; c++) {
          if (rawChanges[c].type === "equal") {
            currentHunk.lines.push(` ${rawChanges[c].line}`);
          }
        }
      } else {
        for (let c = lastChangeIdx + 1; c <= idx; c++) {
          if (rawChanges[c].type === "equal") {
            currentHunk!.lines.push(` ${rawChanges[c].line}`);
          }
        }
      }

      if (ch.type === "del") {
        currentHunk!.lines.push(`-${ch.line}`);
      } else {
        currentHunk!.lines.push(`+${ch.line}`);
      }
      lastChangeIdx = idx;
    }
  }

  if (currentHunk) {
    for (let c = lastChangeIdx + 1; c < Math.min(lastChangeIdx + CONTEXT + 1, rawChanges.length); c++) {
      if (rawChanges[c].type === "equal") {
        currentHunk.lines.push(` ${rawChanges[c].line}`);
      }
    }
    hunks.push(currentHunk);
  }

  for (const hunk of hunks) {
    const delCount = hunk.lines.filter(l => l.startsWith("-")).length;
    const addCount = hunk.lines.filter(l => l.startsWith("+")).length;
    const ctxCount = hunk.lines.filter(l => l.startsWith(" ")).length;
    result.push(`@@ -${hunk.aStart + 1},${delCount + ctxCount} +${hunk.bStart + 1},${addCount + ctxCount} @@`);
    result.push(...hunk.lines);
  }

  return result;
}

function classifyChangeSize(linesChanged: number): "Small" | "Medium" | "Large" {
  if (linesChanged < 20) return "Small";
  if (linesChanged <= 100) return "Medium";
  return "Large";
}

function analyzeContent(content: string): { touchesRoutes: boolean; touchesDb: boolean; touchesEnvVars: boolean } {
  return {
    touchesRoutes: /router\.(get|post|put|patch|delete)\s*\(|app\.(get|post|put|patch|delete)\s*\(/i.test(content),
    touchesDb: /getDb\(\)|fsDb|\.select\(\)|\.insert\(|\.update\(|\.delete\(/i.test(content),
    touchesEnvVars: /process\.env\./i.test(content),
  };
}

function walkDir(dir: string, skipDirs: string[] = []): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, skipDirs));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

function addDirMappings(
  mappings: FileMapping[],
  sourcePath: string,
  fsDirRel: string,
  nexusDirRel: string,
  skipDirs: string[] = []
): void {
  const fsDir = path.join(sourcePath, fsDirRel);
  const fsFiles = walkDir(fsDir, skipDirs);
  for (const absFile of fsFiles) {
    const relFromFsDir = path.relative(fsDir, absFile);
    const fsRel = `${fsDirRel}/${relFromFsDir}`;
    const nexusRel = `${nexusDirRel}/${relFromFsDir}`;
    if (!mappings.some(m => m.fsPath === fsRel)) {
      mappings.push({ fsPath: fsRel, nexusPath: nexusRel });
    }
  }

  const nexusDir = path.resolve(nexusDirRel);
  const nexusFiles = walkDir(nexusDir, skipDirs);
  for (const absFile of nexusFiles) {
    const relFromNexusDir = path.relative(nexusDir, absFile);
    const nexusRel = `${nexusDirRel}/${relFromNexusDir}`;
    const fsRel = `${fsDirRel}/${relFromNexusDir}`;
    if (!mappings.some(m => m.nexusPath === nexusRel)) {
      mappings.push({ fsPath: fsRel, nexusPath: nexusRel });
    }
  }
}

function buildAllMappings(sourcePath: string): FileMapping[] {
  const mappings = [...FILE_MAPPINGS];

  addDirMappings(mappings, sourcePath, PAGE_DIR_FS, PAGE_DIR_NEXUS);
  addDirMappings(mappings, sourcePath, COMPONENT_DIR_FS, COMPONENT_DIR_NEXUS);
  addDirMappings(mappings, sourcePath, HOOK_DIR_FS, "client/src/hooks/fleet-scope");

  return mappings;
}

function getIncorporationGuidance(result: DriftResult): string[] {
  const lines: string[] = [];
  if (result.category === "modified") {
    lines.push(`Update: ${result.nexusPath}`);
    lines.push(`Apply the following import substitutions when porting changes:`);
    lines.push(`  @shared/schema       -> @shared/fleet-scope-schema`);
    lines.push(`  /api/                 -> /api/fs/`);
    lines.push(`  ./db                  -> ./fleet-scope-db`);
    lines.push(`  ./storage             -> ./fleet-scope-storage`);
    lines.push(`  ./snowflake           -> ./fleet-scope-snowflake`);
    lines.push(`  registerRoutes        -> registerFleetScopeRoutes`);
    lines.push(`  process.env.XXX       -> process.env.FS_XXX (for Fleet-Scope env vars)`);
    if (result.touchesRoutes) lines.push(`  [!] Change touches API routes — verify /api/fs/ prefix`);
    if (result.touchesDb) lines.push(`  [!] Change touches database queries — verify fsDb connection`);
    if (result.touchesEnvVars) lines.push(`  [!] Change touches env vars — verify FS_ prefix on all Fleet-Scope vars`);
  } else if (result.category === "added") {
    lines.push(`Create: ${result.nexusPath}`);
    lines.push(`Copy the file from Fleet-Scope and apply these import substitutions:`);
    lines.push(`  @shared/schema       -> @shared/fleet-scope-schema`);
    lines.push(`  /api/                 -> /api/fs/`);
    lines.push(`  ./db                  -> ./fleet-scope-db`);
    lines.push(`  ./storage             -> ./fleet-scope-storage`);
    lines.push(`  ./snowflake           -> ./fleet-scope-snowflake`);
    lines.push(`  registerRoutes        -> registerFleetScopeRoutes`);
    lines.push(`  process.env.XXX       -> process.env.FS_XXX (for Fleet-Scope env vars)`);
    if (result.touchesRoutes) lines.push(`  [!] New file has API routes — add with /api/fs/ prefix`);
    if (result.touchesDb) lines.push(`  [!] New file uses database — ensure it uses fsDb connection`);
    if (result.touchesEnvVars) lines.push(`  [!] New file uses env vars — apply FS_ prefix`);
  } else if (result.category === "deleted") {
    lines.push(`Review: ${result.nexusPath}`);
    lines.push(`This file was removed from Fleet-Scope — consider removing from Nexus.`);
  }
  return lines;
}

function extractZip(zipPath: string, destDir: string): void {
  const buf = fs.readFileSync(zipPath);
  const eocdOffset = findEOCD(buf);
  if (eocdOffset === -1) throw new Error("Invalid ZIP: End of Central Directory not found");

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  let offset = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;

    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const fileName = buf.toString("utf-8", offset + 46, offset + 46 + nameLen);

    offset += 46 + nameLen + extraLen + commentLen;

    if (fileName.endsWith("/")) {
      const dirPath = path.resolve(destDir, fileName);
      if (!dirPath.startsWith(path.resolve(destDir) + path.sep) && dirPath !== path.resolve(destDir)) {
        continue;
      }
      fs.mkdirSync(dirPath, { recursive: true });
      continue;
    }

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = buf.subarray(dataOffset, dataOffset + compressedSize);

    let fileData: Buffer;
    if (compressionMethod === 0) {
      fileData = compressedData;
    } else if (compressionMethod === 8) {
      fileData = zlib.inflateRawSync(compressedData);
    } else {
      continue;
    }

    const destPath = path.resolve(destDir, fileName);
    if (!destPath.startsWith(path.resolve(destDir) + path.sep)) {
      continue;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, fileData);
  }
}

function findEOCD(buf: Buffer): number {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function main() {
  const args = process.argv.slice(2);
  let sourcePath = "Fleet-Scope Zip/Fleet-Scope";
  let summaryOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      sourcePath = args[i + 1];
      i++;
    } else if (args[i] === "--summary-only") {
      summaryOnly = true;
    }
  }

  if (!fs.existsSync(sourcePath)) {
    console.error(`${RED}ERROR: Fleet-Scope source not found at: ${sourcePath}${RESET}`);
    console.error(`Provide a valid path with --source <path>`);
    process.exit(1);
  }

  let tempDir: string | null = null;
  const stat = fs.statSync(sourcePath);
  if (!stat.isDirectory()) {
    if (sourcePath.endsWith(".zip")) {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-drift-"));
      console.log(`${GRAY}Extracting ZIP to temporary directory...${RESET}`);
      try {
        extractZip(path.resolve(sourcePath), tempDir);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${RED}ERROR: Failed to extract ZIP: ${msg}${RESET}`);
        process.exit(1);
      }
      const entries = fs.readdirSync(tempDir);
      if (entries.length === 1 && fs.statSync(path.join(tempDir, entries[0])).isDirectory()) {
        sourcePath = path.join(tempDir, entries[0]);
      } else {
        sourcePath = tempDir;
      }
    } else {
      console.error(`${RED}ERROR: ${sourcePath} is not a directory or ZIP file${RESET}`);
      process.exit(1);
    }
  }

  const timestamp = new Date().toISOString();
  console.log(`\n${BOLD}${CYAN}=== Fleet-Scope Code Drift Detection ===${RESET}`);
  console.log(`${GRAY}Source:    ${sourcePath}${RESET}`);
  console.log(`${GRAY}Timestamp: ${timestamp}${RESET}\n`);

  const mappings = buildAllMappings(sourcePath);
  const results: DriftResult[] = [];

  for (const mapping of mappings) {
    const fsFullPath = path.join(sourcePath, mapping.fsPath);
    const nexusFullPath = path.resolve(mapping.nexusPath);
    const fsExists = fs.existsSync(fsFullPath);
    const nexusExists = fs.existsSync(nexusFullPath);

    if (!fsExists && !nexusExists) continue;

    if (fsExists && !nexusExists) {
      const content = fs.readFileSync(fsFullPath, "utf-8");
      const analysis = analyzeContent(content);
      const lineCount = content.split("\n").length;
      results.push({
        fsPath: mapping.fsPath,
        nexusPath: mapping.nexusPath,
        category: "added",
        linesChanged: lineCount,
        changeSize: classifyChangeSize(lineCount),
        fullContent: content,
        ...analysis,
      });
      continue;
    }

    if (!fsExists && nexusExists) {
      results.push({
        fsPath: mapping.fsPath,
        nexusPath: mapping.nexusPath,
        category: "deleted",
      });
      continue;
    }

    const fsContent = fs.readFileSync(fsFullPath, "utf-8");
    const nexusContent = fs.readFileSync(nexusFullPath, "utf-8");
    const normalizedNexus = normalizeNexusContent(nexusContent);

    const fsLines = fsContent.split("\n");
    const nexusLines = normalizedNexus.split("\n");

    if (fsLines.join("\n").trim() === nexusLines.join("\n").trim()) {
      results.push({
        fsPath: mapping.fsPath,
        nexusPath: mapping.nexusPath,
        category: "unchanged",
      });
      continue;
    }

    const diffLines = computeUnifiedDiff(nexusLines, fsLines, `nexus:${mapping.nexusPath}`, `fs:${mapping.fsPath}`);
    const changedLineCount = diffLines.filter(l => l.startsWith("+") && !l.startsWith("+++") || l.startsWith("-") && !l.startsWith("---")).length;
    const analysis = analyzeContent(fsContent);

    results.push({
      fsPath: mapping.fsPath,
      nexusPath: mapping.nexusPath,
      category: "modified",
      diffLines,
      linesChanged: changedLineCount,
      changeSize: classifyChangeSize(changedLineCount),
      ...analysis,
    });
  }

  const modified = results.filter(r => r.category === "modified");
  const added = results.filter(r => r.category === "added");
  const deleted = results.filter(r => r.category === "deleted");
  const unchanged = results.filter(r => r.category === "unchanged");

  console.log(`${BOLD}Summary${RESET}`);
  console.log(`${"─".repeat(50)}`);
  console.log(`  Total files compared: ${results.length}`);
  console.log(`  ${YELLOW}Modified:${RESET}  ${modified.length}`);
  console.log(`  ${GREEN}Added:${RESET}     ${added.length}`);
  console.log(`  ${RED}Deleted:${RESET}   ${deleted.length}`);
  console.log(`  ${GRAY}Unchanged:${RESET} ${unchanged.length}`);
  console.log();

  if (!summaryOnly) {
    if (modified.length > 0) {
      console.log(`${BOLD}${YELLOW}Modified Files${RESET}`);
      console.log(`${"─".repeat(50)}`);
      for (const r of modified) {
        console.log(`\n${YELLOW}[MODIFIED]${RESET} ${r.fsPath}`);
        console.log(`  Nexus path:  ${r.nexusPath}`);
        console.log(`  Change size: ${r.changeSize} (${r.linesChanged} lines changed)`);
        if (r.touchesRoutes) console.log(`  ${RED}[!] Touches API routes${RESET}`);
        if (r.touchesDb) console.log(`  ${RED}[!] Touches database queries${RESET}`);
        if (r.touchesEnvVars) console.log(`  ${RED}[!] Touches environment variables${RESET}`);
        console.log();
        if (r.diffLines) {
          for (const line of r.diffLines) {
            if (line.startsWith("+++") || line.startsWith("---")) {
              console.log(`${BOLD}${line}${RESET}`);
            } else if (line.startsWith("+")) {
              console.log(`${GREEN}${line}${RESET}`);
            } else if (line.startsWith("-")) {
              console.log(`${RED}${line}${RESET}`);
            } else if (line.startsWith("@@")) {
              console.log(`${CYAN}${line}${RESET}`);
            } else {
              console.log(line);
            }
          }
        }
        console.log();
        console.log(`  ${BOLD}How to incorporate:${RESET}`);
        for (const g of getIncorporationGuidance(r)) {
          console.log(`    ${g}`);
        }
        console.log();
      }
    }

    if (added.length > 0) {
      console.log(`${BOLD}${GREEN}Added Files (new in Fleet-Scope, not in Nexus)${RESET}`);
      console.log(`${"─".repeat(50)}`);
      for (const r of added) {
        console.log(`\n${GREEN}[ADDED]${RESET} ${r.fsPath}`);
        console.log(`  Recommended Nexus path: ${r.nexusPath}`);
        console.log(`  File size: ${r.linesChanged} lines (${r.changeSize})`);
        if (r.touchesRoutes) console.log(`  ${RED}[!] Contains API routes${RESET}`);
        if (r.touchesDb) console.log(`  ${RED}[!] Contains database queries${RESET}`);
        if (r.touchesEnvVars) console.log(`  ${RED}[!] Contains environment variables${RESET}`);
        console.log();
        if (r.fullContent) {
          for (const line of r.fullContent.split("\n")) {
            console.log(`  ${GREEN}+ ${line}${RESET}`);
          }
        }
        console.log();
        console.log(`  ${BOLD}How to incorporate:${RESET}`);
        for (const g of getIncorporationGuidance(r)) {
          console.log(`    ${g}`);
        }
        console.log();
      }
    }

    if (deleted.length > 0) {
      console.log(`${BOLD}${RED}Deleted Files (removed from Fleet-Scope, still in Nexus)${RESET}`);
      console.log(`${"─".repeat(50)}`);
      for (const r of deleted) {
        console.log(`\n${RED}[DELETED]${RESET} ${r.fsPath}`);
        console.log(`  Nexus path: ${r.nexusPath}`);
        console.log();
        console.log(`  ${BOLD}How to incorporate:${RESET}`);
        for (const g of getIncorporationGuidance(r)) {
          console.log(`    ${g}`);
        }
        console.log();
      }
    }
  }

  const actionable = [...modified, ...added, ...deleted].sort((a, b) => (b.linesChanged || 0) - (a.linesChanged || 0));

  if (actionable.length > 0) {
    console.log(`${BOLD}${CYAN}Next Steps (priority order — largest changes first)${RESET}`);
    console.log(`${"─".repeat(70)}`);
    for (let i = 0; i < actionable.length; i++) {
      const r = actionable[i];
      const categoryColor = r.category === "modified" ? YELLOW : r.category === "added" ? GREEN : RED;
      const categoryLabel = r.category.toUpperCase();
      const size = r.changeSize ? ` (${r.changeSize}, ${r.linesChanged} lines)` : "";
      const flags: string[] = [];
      if (r.touchesRoutes) flags.push("routes");
      if (r.touchesDb) flags.push("db");
      if (r.touchesEnvVars) flags.push("env");
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      console.log(`  ${i + 1}. ${categoryColor}[${categoryLabel}]${RESET} ${r.nexusPath}${size}${flagStr}`);
    }
    console.log();
  }

  if (unchanged.length > 0 && !summaryOnly) {
    console.log(`${GRAY}Unchanged Files (${unchanged.length})${RESET}`);
    for (const r of unchanged) {
      console.log(`  ${GRAY}${r.fsPath} -> ${r.nexusPath}${RESET}`);
    }
    console.log();
  }

  const driftDetected = actionable.length > 0;
  if (driftDetected) {
    console.log(`${YELLOW}${BOLD}Drift detected: ${actionable.length} file(s) need attention.${RESET}\n`);
  } else {
    console.log(`${GREEN}${BOLD}No drift detected. Fleet-Scope and Nexus are in sync.${RESET}\n`);
  }

  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  process.exit(driftDetected ? 1 : 0);
}

main();
