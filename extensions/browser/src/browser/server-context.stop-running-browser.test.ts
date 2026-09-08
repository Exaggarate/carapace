// Browser tests cover server context.stop running browser plugin behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRouteContext } from "./server-context.js";
import { makeBrowserProfile, makeBrowserServerState } from "./server-context.test-harness.js";

const pwAiMocks = vi.hoisted(() => {
  const closePlaywrightBrowserConnection = vi.fn(async (_opts?: { cdpUrl?: string }) => {});
  return {
    closePlaywrightBrowserConnection,
    retirePlaywrightBrowserConnection: vi.fn((opts?: { cdpUrl?: string }) => {
      void closePlaywrightBrowserConnection(opts);
      return true;
    }),
    retirePlaywrightBrowserConnectionExact: vi.fn((opts: { cdpUrl: string }) => ({
      retired: true,
      close: async () => await closePlaywrightBrowserConnection(opts),
    })),
  };
});

const chromeMocks = vi.hoisted(() => ({
  stopOwnedCarapaceChrome: vi.fn(async () => false),
}));

vi.mock("./pw-ai.js", () => ({ pwAi: pwAiMocks }));
vi.mock("./chrome.js", () => ({
  isChromeCdpOwnedByPid: vi.fn(async () => true),
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchCarapaceChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveCarapaceUserDataDir: vi.fn(() => "/tmp/carapace-test"),
  stopOwnedCarapaceChrome: chromeMocks.stopOwnedCarapaceChrome,
  stopCarapaceChrome: vi.fn(async () => {}),
}));
vi.mock("./chrome-mcp.js", () => ({
  closeChromeMcpSession: vi.fn(async () => false),
  countChromeMcpTabs: vi.fn(async () => 0),
  ensureChromeMcpAvailable: vi.fn(async () => {}),
  listChromeMcpTabs: vi.fn(async () => []),
}));

afterEach(() => {
  vi.clearAllMocks();
  chromeMocks.stopOwnedCarapaceChrome.mockResolvedValue(false);
});

function createStopHarness(profile: ReturnType<typeof makeBrowserProfile>) {
  const state = makeBrowserServerState({
    profile,
    resolvedOverrides: {
      ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
    },
  });
  const ctx = createBrowserRouteContext({ getState: () => state });
  return { profileCtx: ctx.forProfile(profile.name) };
}

describe("createProfileAvailability.stopRunningBrowser", () => {
  it("stops an unused attachOnly loopback profile without loading Playwright", async () => {
    const profile = makeBrowserProfile({ attachOnly: true });
    const { profileCtx } = createStopHarness(profile);

    await expect(profileCtx.stopRunningBrowser()).resolves.toEqual({ stopped: true });
    expect(pwAiMocks.closePlaywrightBrowserConnection).not.toHaveBeenCalled();
    expect(chromeMocks.stopOwnedCarapaceChrome).not.toHaveBeenCalled();
  });

  it("stops an unused remote CDP profile without loading Playwright", async () => {
    const profile = makeBrowserProfile({
      cdpUrl: "http://10.0.0.5:9222",
      cdpHost: "10.0.0.5",
      cdpIsLoopback: false,
      cdpPort: 9222,
    });
    const { profileCtx } = createStopHarness(profile);

    await expect(profileCtx.stopRunningBrowser()).resolves.toEqual({ stopped: true });
    expect(pwAiMocks.closePlaywrightBrowserConnection).not.toHaveBeenCalled();
    expect(chromeMocks.stopOwnedCarapaceChrome).not.toHaveBeenCalled();
  });

  it("keeps never-started local managed profiles as not stopped", async () => {
    const profile = makeBrowserProfile();
    const { profileCtx } = createStopHarness(profile);

    await expect(profileCtx.stopRunningBrowser()).resolves.toEqual({ stopped: false });
    expect(pwAiMocks.closePlaywrightBrowserConnection).not.toHaveBeenCalled();
  });

  it("stops a local managed browser launched by another runtime", async () => {
    chromeMocks.stopOwnedCarapaceChrome.mockResolvedValue(true);
    const profile = makeBrowserProfile();
    const { profileCtx } = createStopHarness(profile);

    await expect(profileCtx.stopRunningBrowser()).resolves.toEqual({ stopped: true });
    expect(chromeMocks.stopOwnedCarapaceChrome).toHaveBeenCalledOnce();
    expect(pwAiMocks.closePlaywrightBrowserConnection).not.toHaveBeenCalled();
  });

  it.each(["existing-session", "extension"] as const)(
    "does not attempt to terminate a personal %s browser",
    async (driver) => {
      const profile = makeBrowserProfile({ driver });
      const { profileCtx } = createStopHarness(profile);

      await profileCtx.stopRunningBrowser();

      expect(chromeMocks.stopOwnedCarapaceChrome).not.toHaveBeenCalled();
    },
  );
});
