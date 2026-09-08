import { fileURLToPath } from "node:url";

// Use the native builtin so unrelated node:fs mocks cannot replace this source input.
// Production builds replace this module so packaged database opens need no asset file.
export const CARAPACE_STATE_SCHEMA_SQL = process
  .getBuiltinModule("node:fs")
  .readFileSync(fileURLToPath(new URL("./carapace-state-schema.sql", import.meta.url)), "utf8");
