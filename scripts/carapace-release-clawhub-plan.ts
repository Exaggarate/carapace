#!/usr/bin/env -S node --import tsx
// Carapace release ClawHub plan CLI emits release workflow routing as JSON.

import { pathToFileURL } from "node:url";
import {
  buildCarapaceReleaseClawHubPlan,
  parseCarapaceReleaseClawHubPlanArgs,
} from "./lib/carapace-release-clawhub-plan.ts";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseCarapaceReleaseClawHubPlanArgs(process.argv.slice(2));
  const plan = await buildCarapaceReleaseClawHubPlan(args);
  console.log(JSON.stringify(plan, null, 2));
}
