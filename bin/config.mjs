import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Resolve beside the package, so `ask` keeps working from any directory.
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

export function setting(name, fallback = "") {
    return process.env[name]?.trim() || fallback;
}

export function enabled(name) {
    return /^(1|true|yes|on)$/i.test(setting(name));
}
