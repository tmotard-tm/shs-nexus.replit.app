import * as fs from "fs";
import * as path from "path";
import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  integrationDataSources,
  dataSourceFields,
  type InsertIntegrationDataSource,
  type InsertDataSourceField,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

export type DiscoveredField = {
  fieldName: string;
  displayName: string;
  dataType: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  isRequired?: boolean;
  description?: string;
};

export type DiscoveredSource = {
  name: string;
  displayName: string;
  sourceType: "db_table" | "api_endpoint" | "snowflake_query" | "file_import";
  connectionInfo?: Record<string, any>;
  description?: string;
  fields: DiscoveredField[];
};

const ROOT = process.cwd();

function safeRead(rel: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// DB table discovery — introspect live Postgres via information_schema
// ---------------------------------------------------------------------------
export async function discoverDbTables(): Promise<DiscoveredSource[]> {
  const colsRes: any = await db.execute(sql`
    SELECT table_name, column_name, data_type, is_nullable, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const pkRes: any = await db.execute(sql`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema   = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
  `);
  const fkRes: any = await db.execute(sql`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema   = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  const pkSet = new Set<string>(
    (pkRes.rows ?? pkRes).map((r: any) => `${r.table_name}.${r.column_name}`)
  );
  const fkSet = new Set<string>(
    (fkRes.rows ?? fkRes).map((r: any) => `${r.table_name}.${r.column_name}`)
  );

  const byTable = new Map<string, DiscoveredField[]>();
  for (const row of (colsRes.rows ?? colsRes) as any[]) {
    const t = row.table_name as string;
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t)!.push({
      fieldName: row.column_name,
      displayName: row.column_name,
      dataType: String(row.data_type),
      isPrimaryKey: pkSet.has(`${t}.${row.column_name}`),
      isForeignKey: fkSet.has(`${t}.${row.column_name}`),
      isRequired: row.is_nullable === "NO",
    });
  }

  const skip = new Set([
    "drizzle_migrations",
    "session",
    "sessions",
    "__drizzle_migrations",
  ]);

  const sources: DiscoveredSource[] = [];
  for (const [table, fields] of Array.from(byTable.entries()).sort()) {
    if (skip.has(table)) continue;
    sources.push({
      name: `db_${table}`,
      displayName: table,
      sourceType: "db_table",
      connectionInfo: { schema: "public", table },
      description: `Postgres table public.${table}`,
      fields,
    });
  }
  return sources;
}

// ---------------------------------------------------------------------------
// API endpoint discovery — regex scan of route files
// ---------------------------------------------------------------------------
const ROUTE_FILES = [
  "server/routes.ts",
  "server/fleet-scope-routes.ts",
  "server/vrm/routes.ts",
];

// Build a lookup of `const NAME = z.object({...})` shapes from a file.
function buildZodSchemaLookup(text: string): Map<string, DiscoveredField[]> {
  const out = new Map<string, DiscoveredField[]>();
  // Match: const fooSchema = z.object({ ... });
  const re = /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*z\.object\(\s*\{([\s\S]*?)\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1];
    const body = m[2];
    const fields: DiscoveredField[] = [];
    // Each field: `name: z.string()` etc. Stop at first paren-balanced expression.
    const fieldRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*z\.([a-zA-Z]+)\(/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body))) {
      const fname = fm[1];
      const ztype = fm[2];
      const dt =
        ztype === "string" || ztype === "enum" || ztype === "uuid"
          ? "string"
          : ztype === "number" || ztype === "int"
          ? "number"
          : ztype === "boolean"
          ? "boolean"
          : ztype === "date"
          ? "date"
          : ztype === "array"
          ? "array"
          : ztype === "object"
          ? "object"
          : "string";
      if (!fields.some((f) => f.fieldName === fname)) {
        fields.push({ fieldName: fname, displayName: fname, dataType: dt });
      }
    }
    out.set(name, fields);
  }
  return out;
}

export async function discoverApiEndpoints(): Promise<DiscoveredSource[]> {
  const seen = new Set<string>();
  const out: DiscoveredSource[] = [];

  // app.get("/foo", ...handler...). Capture up to ~600 chars after the path
  // to look for a Zod parse call. Greedy enough for typical inline handlers.
  const re =
    /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]([\s\S]{0,800}?)(?:\}\s*\)|;)/g;

  for (const file of ROUTE_FILES) {
    const text = safeRead(file);
    if (!text) continue;
    const zodLookup = buildZodSchemaLookup(text);
    const prefix = file.includes("vrm/routes.ts")
      ? "/api/vrm"
      : file.includes("fleet-scope-routes.ts")
      ? ""
      : "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const method = m[1].toUpperCase();
      let route = m[2];
      const handlerSnippet = m[3] || "";
      if (!route.startsWith("/")) continue;
      if (prefix && !route.startsWith(prefix)) {
        route = prefix + route;
      }
      const key = `${method} ${route}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Try to extract fields from a Zod schema referenced in the handler.
      let fields: DiscoveredField[] = [];
      const parseMatch = /([A-Za-z_][A-Za-z0-9_]*Schema)\s*\.\s*(?:safeParse|parse)\s*\(/.exec(
        handlerSnippet
      );
      if (parseMatch) {
        const looked = zodLookup.get(parseMatch[1]);
        if (looked) fields = looked;
      }
      // Inline z.object in handler
      if (fields.length === 0) {
        const inlineMatch = /z\.object\(\s*\{([\s\S]{0,600}?)\}\s*\)/.exec(handlerSnippet);
        if (inlineMatch) {
          const tmp = buildZodSchemaLookup(`const _x = z.object({${inlineMatch[1]}})`);
          fields = tmp.get("_x") || [];
        }
      }

      out.push({
        name: `api_${method.toLowerCase()}_${route.replace(/[^a-zA-Z0-9]+/g, "_")}`,
        displayName: `${method} ${route}`,
        sourceType: "api_endpoint",
        connectionInfo: { method, path: route, sourceFile: file },
        description: `Express endpoint ${method} ${route}`,
        fields,
      });
    }
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ---------------------------------------------------------------------------
// Snowflake query discovery — scan for executeQuery/SELECT literals
// ---------------------------------------------------------------------------
function listAllServerTsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(rel);
      } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
        out.push(rel);
      }
    }
  };
  walk("server");
  return out;
}

function parseSelectColumns(sqlText: string): DiscoveredField[] {
  // Strip block comments and trim
  const cleaned = sqlText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /\bSELECT\b\s+(?:DISTINCT\s+)?([\s\S]+?)\s+\bFROM\b/i.exec(cleaned);
  if (!m) return [];
  const list = m[1];
  if (list.trim() === "*") return [];

  // Naive comma split respecting parens
  const cols: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      cols.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) cols.push(buf.trim());

  const fields: DiscoveredField[] = [];
  for (const c of cols) {
    // alias detection: "expr AS alias" or "expr alias"
    let name = c;
    const asMatch = /\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(c);
    if (asMatch) name = asMatch[1];
    else {
      const tail = c.split(/\s+/).pop() || c;
      const ident = /^([A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(
        tail
      );
      if (ident) name = ident[2];
      else continue; // skip complex expressions w/o alias
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (fields.some((f) => f.fieldName === name)) continue;
    fields.push({
      fieldName: name,
      displayName: name,
      dataType: "string",
      description: "Best-effort parsed from SELECT",
    });
  }
  return fields;
}

export async function discoverSnowflakeQueries(): Promise<DiscoveredSource[]> {
  const out: DiscoveredSource[] = [];
  const seen = new Set<string>();

  // Match backtick-template SQL containing SELECT ... FROM
  const re = /`([\s\S]*?\bSELECT\b[\s\S]*?\bFROM\b[\s\S]*?)`/gi;

  // Scan every server file that mentions executeQuery / Snowflake / SNOWFLAKE.
  // This broadens beyond a fixed allowlist per task requirements.
  const allFiles = listAllServerTsFiles();
  const SNOWFLAKE_FILES = allFiles.filter((f) => {
    const text = safeRead(f);
    return /executeQuery\s*\(|SNOWFLAKE_|snowflake/i.test(text);
  });

  for (const file of SNOWFLAKE_FILES) {
    const text = safeRead(file);
    if (!text) continue;
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = re.exec(text))) {
      const sqlText = m[1];
      if (sqlText.length > 5000) continue; // skip huge blobs
      // Skip template literals with too many ${} interpolations of branches
      const interp = (sqlText.match(/\$\{/g) || []).length;
      if (interp > 8) continue;

      // Stable signature: file + first 80 normalized chars
      const sig =
        path.basename(file) +
        ":" +
        sqlText.replace(/\s+/g, " ").trim().slice(0, 80).toLowerCase();
      if (seen.has(sig)) continue;
      seen.add(sig);

      const fields = parseSelectColumns(sqlText);
      const fromMatch = /\bFROM\s+([A-Za-z_][A-Za-z0-9_\.]*)/i.exec(sqlText);
      const fromTable = fromMatch ? fromMatch[1] : "unknown";
      const shortName = `sf_${path.basename(file, ".ts")}_${fromTable.replace(
        /\W/g,
        "_"
      )}_${idx}`;
      idx++;
      out.push({
        name: shortName,
        displayName: `Snowflake: ${fromTable}`,
        sourceType: "snowflake_query",
        connectionInfo: {
          sourceFile: file,
          fromTable,
          sqlPreview: sqlText.replace(/\s+/g, " ").trim().slice(0, 240),
        },
        description: `Snowflake query in ${path.basename(file)} reading ${fromTable}`,
        fields,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// File import discovery — multer/papaparse/XLSX usage
// ---------------------------------------------------------------------------
export async function discoverFileImports(): Promise<DiscoveredSource[]> {
  const out: DiscoveredSource[] = [];
  const seen = new Set<string>();
  const scanFiles = [
    "server/routes.ts",
    "server/fleet-scope-routes.ts",
    "server/vrm/routes.ts",
  ];

  for (const file of scanFiles) {
    const text = safeRead(file);
    if (!text) continue;

    // multer upload handlers: app.post("/x", upload.single(...) or upload.array(...))
    // Capture a wider handler window so we can look for declared headers.
    const importRe =
      /(?:app|router)\.(post|put)\s*\(\s*["'`]([^"'`]+)["'`]([\s\S]{0,2500}?)(upload\.(?:single|array|fields)|multer\(|XLSX\.read|Papa\.parse|papaparse)/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(text))) {
      const route = m[2];
      const handlerWindow = (m[3] || "") + (m[0] || "");
      const kind = m[4];
      const key = `${file}:${route}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Best-effort header extraction. Look for arrays of string literals near
      // tokens like `expectedHeaders`, `headers`, `columns`, `REQUIRED_HEADERS`.
      const fields: DiscoveredField[] = [];
      const headerHints =
        /(?:expectedHeaders|REQUIRED_HEADERS|HEADERS|headers|columns|fields)\s*[:=]\s*\[([\s\S]{1,800}?)\]/g;
      let hh: RegExpExecArray | null;
      while ((hh = headerHints.exec(handlerWindow))) {
        const arr = hh[1];
        const lits = arr.match(/["'`]([^"'`]+)["'`]/g) || [];
        for (const lit of lits) {
          const name = lit.replace(/^["'`]|["'`]$/g, "");
          if (!name || name.length > 80) continue;
          if (fields.some((f) => f.fieldName === name)) continue;
          fields.push({
            fieldName: name,
            displayName: name,
            dataType: "string",
            description: "Declared header from upload handler",
          });
        }
        if (fields.length > 0) break;
      }

      out.push({
        name: `import_${route.replace(/[^a-zA-Z0-9]+/g, "_")}`,
        displayName: `Upload ${route}`,
        sourceType: "file_import",
        connectionInfo: {
          route,
          parser: kind,
          sourceFile: file,
          headerCount: fields.length,
          headersPopulated: fields.length === 0 ? "from last import" : "from code",
        },
        description: `File import handler ${route} (${kind})`,
        fields,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discovery state
// ---------------------------------------------------------------------------
type DiscoveryStatusEntry = {
  lastRun: string | null;
  count: number;
};
const discoveryStatus: Record<string, DiscoveryStatusEntry> = {
  db_table: { lastRun: null, count: 0 },
  api_endpoint: { lastRun: null, count: 0 },
  snowflake_query: { lastRun: null, count: 0 },
  file_import: { lastRun: null, count: 0 },
};

export function getDiscoveryStatus() {
  return discoveryStatus;
}

// ---------------------------------------------------------------------------
// Upsert helper
// ---------------------------------------------------------------------------
async function upsertDiscoveredSources(
  discovered: DiscoveredSource[],
  sourceType: DiscoveredSource["sourceType"]
) {
  // Load existing sources of this type
  const existing = await db
    .select()
    .from(integrationDataSources)
    .where(eq(integrationDataSources.sourceType, sourceType));
  const existingByName = new Map(existing.map((s) => [s.name, s]));
  const discoveredNames = new Set(discovered.map((d) => d.name));

  for (const d of discovered) {
    const meta = JSON.stringify({ stale: false, discoveredAt: new Date().toISOString() });
    const conn = d.connectionInfo ? JSON.stringify(d.connectionInfo) : null;

    let sourceId: string;
    const ex = existingByName.get(d.name);
    if (ex) {
      await db
        .update(integrationDataSources)
        .set({
          displayName: d.displayName,
          connectionInfo: conn,
          description: d.description ?? null,
          metadata: meta,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(integrationDataSources.id, ex.id));
      sourceId = ex.id;
    } else {
      const [created] = await db
        .insert(integrationDataSources)
        .values({
          name: d.name,
          displayName: d.displayName,
          sourceType: d.sourceType,
          connectionInfo: conn,
          description: d.description ?? null,
          metadata: meta,
          isActive: true,
        } as InsertIntegrationDataSource)
        .returning();
      sourceId = created.id;
    }

    // Upsert fields for this source by (sourceId, fieldName)
    const existingFields = await db
      .select()
      .from(dataSourceFields)
      .where(eq(dataSourceFields.sourceId, sourceId));
    const existingFieldsByName = new Map(
      existingFields.map((f) => [f.fieldName, f])
    );
    const discoveredFieldNames = new Set(d.fields.map((f) => f.fieldName));

    for (const f of d.fields) {
      const ef = existingFieldsByName.get(f.fieldName);
      const fmeta = JSON.stringify({ stale: false });
      if (ef) {
        await db
          .update(dataSourceFields)
          .set({
            displayName: f.displayName,
            dataType: f.dataType,
            isPrimaryKey: !!f.isPrimaryKey,
            isForeignKey: !!f.isForeignKey,
            isRequired: !!f.isRequired,
            description: f.description ?? null,
            metadata: fmeta,
          })
          .where(eq(dataSourceFields.id, ef.id));
      } else {
        await db.insert(dataSourceFields).values({
          sourceId,
          fieldName: f.fieldName,
          displayName: f.displayName,
          dataType: f.dataType,
          isPrimaryKey: !!f.isPrimaryKey,
          isForeignKey: !!f.isForeignKey,
          isRequired: !!f.isRequired,
          description: f.description ?? null,
          metadata: fmeta,
        } as InsertDataSourceField);
      }
    }

    // Mark stale any fields no longer present
    for (const ef of existingFields) {
      if (!discoveredFieldNames.has(ef.fieldName)) {
        await db
          .update(dataSourceFields)
          .set({ metadata: JSON.stringify({ stale: true }) })
          .where(eq(dataSourceFields.id, ef.id));
      }
    }
  }

  // Mark stale any sources of this type no longer discovered
  for (const ex of existing) {
    if (!discoveredNames.has(ex.name)) {
      await db
        .update(integrationDataSources)
        .set({
          metadata: JSON.stringify({ stale: true }),
          updatedAt: new Date(),
        })
        .where(eq(integrationDataSources.id, ex.id));
    }
  }

  discoveryStatus[sourceType] = {
    lastRun: new Date().toISOString(),
    count: discovered.length,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
export async function refreshAllDiscovery(): Promise<{
  db_table: number;
  api_endpoint: number;
  snowflake_query: number;
  file_import: number;
}> {
  const [dbs, apis, sfs, files] = await Promise.all([
    discoverDbTables(),
    discoverApiEndpoints(),
    discoverSnowflakeQueries(),
    discoverFileImports(),
  ]);

  await upsertDiscoveredSources(dbs, "db_table");
  await upsertDiscoveredSources(apis, "api_endpoint");
  await upsertDiscoveredSources(sfs, "snowflake_query");
  await upsertDiscoveredSources(files, "file_import");

  return {
    db_table: dbs.length,
    api_endpoint: apis.length,
    snowflake_query: sfs.length,
    file_import: files.length,
  };
}
