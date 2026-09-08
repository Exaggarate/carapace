import type { CarapaceConfig } from "../config/types.carapace.js";

const DEFAULT_REMOTE_MODEL_CATALOG_URL = "https://github.com/Exaggarate/carapace";

export function isRemoteModelCatalogRefreshEnabled(config: CarapaceConfig): boolean {
  return config.models?.catalogRefresh?.enabled !== false;
}

export function resolveRemoteCatalogUrl(config: CarapaceConfig): string {
  return config.models?.catalogRefresh?.url?.trim() || DEFAULT_REMOTE_MODEL_CATALOG_URL;
}
