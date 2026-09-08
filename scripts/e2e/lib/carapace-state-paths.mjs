import path from "node:path";

export function resolveHomePath(value) {
  if (value === "~") {
    return process.env.HOME;
  }
  if (value?.startsWith("~/") || value?.startsWith("~\\")) {
    return path.join(process.env.HOME, value.slice(2));
  }
  return value;
}

export function resolveCarapaceStateDir() {
  return process.env.CARAPACE_STATE_DIR || path.join(process.env.HOME, ".carapace");
}

export function resolveCarapaceConfigPath() {
  return process.env.CARAPACE_CONFIG_PATH || path.join(resolveCarapaceStateDir(), "carapace.json");
}
