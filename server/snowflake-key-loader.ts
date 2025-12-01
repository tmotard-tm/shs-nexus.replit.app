import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export function loadKeyFromFile(): string | null {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const keyFilePath = path.join(__dirname, "snowflake-private-key.p8");
    
    if (fs.existsSync(keyFilePath)) {
      return fs.readFileSync(keyFilePath, "utf-8");
    }
  } catch (error) {
    console.log("[Snowflake] Error loading key from file:", error);
  }
  return null;
}
