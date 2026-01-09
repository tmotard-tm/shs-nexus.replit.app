export function loadKeyFromFile(): string | null {
  const key = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (key) {
    return key.replace(/\\n/g, "\n");
  }
  return null;
}
