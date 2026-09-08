// Declares extension points for agent session type augmentation.
export type CarapaceAgentSessionSkillSourceAugmentation = never;

declare module "carapace/plugin-sdk/agent-sessions" {
  interface Skill {
    // Carapace relies on the source identifier returned by skill loaders.
    source: string;
  }
}
