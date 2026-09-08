import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";

type CarapaceStateDatabaseSchemaMigrationRequiredKind =
  | "agent-databases-composite-primary-key"
  | "audit-events-v2";

export class CarapaceStateDatabaseSchemaMigrationRequiredError extends StartupMaintenanceRequiredError {
  constructor(
    override readonly kind: CarapaceStateDatabaseSchemaMigrationRequiredKind,
    readonly pathname: string,
  ) {
    super(
      kind,
      `Carapace state database schema migration required (${kind}) at ${pathname}; run carapace doctor --fix to migrate it.`,
    );
    this.name = "CarapaceStateDatabaseSchemaMigrationRequiredError";
  }
}
