import type { CarapaceConfig } from "../../config/types.carapace.js";
import { readSkillProposalRecord as readSkillProposalRecordImpl } from "../../skills/workshop/store.js";

const workshopConfig: CarapaceConfig = {};

export function readSkillWorkshopTestProposalRecord(
  proposalId: string,
  options: { stateDir?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return readSkillProposalRecordImpl(
    proposalId,
    { config: workshopConfig, ...options },
    {},
    { config: workshopConfig },
  );
}
