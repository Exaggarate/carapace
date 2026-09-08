import {
  normalizeModelPricingCatalog,
  normalizeOpenRouterModelPricing,
} from "carapace/plugin-sdk/model-catalog-pricing";
import { asOptionalRecord } from "carapace/plugin-sdk/string-coerce-runtime";

export function parseCerebrasPricingCatalog(payload: unknown) {
  return normalizeModelPricingCatalog(
    asOptionalRecord(payload)?.data,
    normalizeOpenRouterModelPricing,
  );
}
