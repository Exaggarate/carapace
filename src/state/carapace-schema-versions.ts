export type CarapaceSchemaVersions = {
  state: number;
  agent: number;
};

export function parseCarapaceSchemaVersions(value: unknown): CarapaceSchemaVersions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !Number.isInteger(record.state) ||
    (record.state as number) < 0 ||
    !Number.isInteger(record.agent) ||
    (record.agent as number) < 0
  ) {
    return undefined;
  }
  return { state: record.state as number, agent: record.agent as number };
}

export function parsePackageCarapaceSchemaVersions(
  packageJson: unknown,
): CarapaceSchemaVersions | undefined {
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    return undefined;
  }
  const carapace = (packageJson as Record<string, unknown>).carapace;
  if (!carapace || typeof carapace !== "object" || Array.isArray(carapace)) {
    return undefined;
  }
  return parseCarapaceSchemaVersions((carapace as Record<string, unknown>).schemaVersions);
}
