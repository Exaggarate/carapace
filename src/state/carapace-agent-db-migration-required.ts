import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";

export class CarapaceAgentDatabaseMediaMigrationRequiredError extends StartupMaintenanceRequiredError {
  constructor(
    readonly pathname: string,
    readonly schemaVersion: number,
  ) {
    super(
      "agent-media",
      `Carapace agent database ${pathname} uses schema version ${schemaVersion}; run carapace doctor --fix to migrate persisted media before using it.`,
    );
    this.name = "CarapaceAgentDatabaseMediaMigrationRequiredError";
  }
}
