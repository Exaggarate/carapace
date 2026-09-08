import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  PROJECTS_LIST_DEFAULT_LIMIT,
  PROJECTS_LIST_MAX_CHECKOUTS_PER_PROJECT,
  ProjectRecordSchema,
  ProjectsAddResultSchema,
  ProjectSummarySchema,
  ProjectsListResultSchema,
  ProjectsSearchRemoteResultSchema,
  validateProjectsAddParams,
  validateProjectsListParams,
  validateProjectsRegisterParams,
  validateProjectsRemoveParams,
  validateProjectsSearchRemoteParams,
  validateSessionsCreateParams,
} from "../index.js";

describe("project protocol schemas", () => {
  it("validates project method inputs as closed objects", () => {
    expect(validateProjectsListParams({})).toBe(true);
    expect(validateProjectsListParams({ includeObserved: true })).toBe(true);
    expect(validateProjectsListParams({ includeObserved: false })).toBe(true);
    expect(validateProjectsListParams({ includeObserved: "yes" })).toBe(false);
    expect(validateProjectsListParams({ extra: true })).toBe(false);
    expect(validateProjectsRegisterParams({ path: "/repo", name: "Carapace" })).toBe(true);
    expect(validateProjectsRegisterParams({ path: "" })).toBe(false);
    expect(validateProjectsAddParams({ gitUrl: "https://github.com/Exaggarate/carapace.git" })).toBe(
      true,
    );
    expect(validateProjectsAddParams({ gitUrl: "", unexpected: true })).toBe(false);
    expect(validateProjectsSearchRemoteParams({ query: "carapace" })).toBe(true);
    expect(validateProjectsSearchRemoteParams({ query: "" })).toBe(false);
    expect(validateProjectsRemoveParams({ id: "carapace-2", deleteCheckout: true })).toBe(true);
    expect(validateProjectsRemoveParams({ id: "workspace:main" })).toBe(false);
  });

  it("accepts bounded remote search and clone results", () => {
    const project = {
      id: "carapace",
      displayName: "Carapace",
      repoRoot: "/state/projects/fingerprint/carapace",
      originUrl: "https://github.com/Exaggarate/carapace.git",
      source: "cloned",
    };
    expect(Value.Check(ProjectsAddResultSchema, project)).toBe(true);
    expect(
      Value.Check(ProjectsSearchRemoteResultSchema, {
        credential: "missing",
        projects: [
          {
            name: "carapace",
            fullName: "carapace/carapace",
            description: "Personal AI assistant",
            cloneUrl: "https://github.com/Exaggarate/carapace.git",
            webUrl: "https://github.com/Exaggarate/carapace",
            private: false,
          },
        ],
      }),
    ).toBe(true);
  });

  it("accepts workspace and stored project records", () => {
    expect(
      Value.Check(ProjectRecordSchema, {
        id: "workspace:main",
        displayName: "carapace",
        source: "workspace",
        agentId: "main",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectsListResultSchema, {
        projects: [
          {
            id: "carapace",
            displayName: "Carapace",
            repoRoot: "/repo/carapace",
            originUrl: "https://github.com/Exaggarate/carapace.git",
            source: "registered",
          },
        ],
        recents: [
          { kind: "project", projectId: "carapace", displayName: "Carapace" },
          { kind: "folder", folder: "/repo/scratch", displayName: "scratch" },
        ],
        observedProjects: [],
      }),
    ).toBe(true);
    expect(Value.Check(ProjectsListResultSchema, { projects: [] })).toBe(true);
    expect(Value.Check(ProjectsListResultSchema, { observedProjects: [] })).toBe(false);
  });

  it("bounds observed projects and their checkout lists", () => {
    const project = {
      name: "carapace",
      originUrl: "https://github.com/Exaggarate/carapace.git",
      checkouts: [{ runnerId: "gateway", path: "/repo/carapace" }],
      lastUsedAt: 1,
    };
    expect(Value.Check(ProjectSummarySchema, project)).toBe(true);
    expect(
      Value.Check(ProjectSummarySchema, {
        ...project,
        checkouts: Array.from(
          { length: PROJECTS_LIST_MAX_CHECKOUTS_PER_PROJECT + 1 },
          (_, index) => ({ runnerId: "gateway", path: `/repo/carapace-${index}` }),
        ),
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectsListResultSchema, {
        projects: [],
        observedProjects: Array.from({ length: PROJECTS_LIST_DEFAULT_LIMIT + 1 }, () => project),
      }),
    ).toBe(false);
  });

  it("accepts bounded project identity and remote URL as additive sessions.create parameters", () => {
    expect(validateSessionsCreateParams({ agentId: "main", projectId: "carapace" })).toBe(true);
    expect(validateSessionsCreateParams({ agentId: "main", projectId: "" })).toBe(false);
    expect(
      validateSessionsCreateParams({
        agentId: "main",
        projectGitUrl: "https://github.com/Exaggarate/carapace.git",
      }),
    ).toBe(true);
    expect(validateSessionsCreateParams({ agentId: "main", projectGitUrl: "" })).toBe(false);
    expect(
      validateSessionsCreateParams({ agentId: "main", projectGitUrl: "x".repeat(2_049) }),
    ).toBe(false);
  });
});
