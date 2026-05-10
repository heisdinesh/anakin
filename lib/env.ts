import { readFile } from "node:fs/promises";

export async function getEnvValue(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];

  const locations = [".env.local", ".env", "../.env"];
  for (const filepath of locations) {
    try {
      const txt = await readFile(filepath, "utf8");
      for (const line of txt.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [k, ...rest] = trimmed.split("=");
        if (k !== name) continue;
        return rest.join("=").trim().replace(/^['\"]|['\"]$/g, "");
      }
    } catch {
      // ignore missing file
    }
  }

  return undefined;
}
