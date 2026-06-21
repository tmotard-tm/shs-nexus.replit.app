import { db } from "./db";
import { appSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Generic key/value app settings backed by the `app_settings` table.
 * `value` is jsonb, so a setting may be a boolean, string, number, or object.
 */
export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row ? (row.value as T) : undefined;
}

export async function getBooleanSetting(key: string, fallback = false): Promise<boolean> {
  const v = await getSetting(key);
  return typeof v === "boolean" ? v : fallback;
}

export async function setSetting(
  key: string,
  value: unknown,
  updatedBy?: string | null,
): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value: value as any, updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: value as any, updatedAt: new Date(), updatedBy: updatedBy ?? null },
    });
}
