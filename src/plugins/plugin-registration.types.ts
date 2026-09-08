import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Result } from "@carapace/normalization-core/result";
import type { Command } from "commander";
import type { MessageReceipt } from "../channels/message/types.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import type { ApprovalScope } from "../infra/approval-scope.js";
import type { InternalDiagnosticEventInterest } from "../infra/diagnostic-event-listener-presence.js";
import type {
  DiagnosticEventPrivateData,
  DiagnosticEventInput,
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
} from "../infra/diagnostic-events.js";
import type { DiagnosticTracePropagationBridge as DiagnosticTracePropagationBridgeContract } from "../infra/diagnostic-trace-propagation.js";
import type { SecurityAuditFinding } from "../security/audit.types.js";
import type { DeliveryContext } from "../utils/delivery-context.types.js";
import type { PluginLogger } from "./logger-types.js";
import type { CarapacePluginNodeWorkspace } from "./types.node-host.js";

type ChannelPlugin = import("../channels/plugins/types.plugin.js").ChannelPlugin;
type DiagnosticTracePropagationBridge = DiagnosticTracePropagationBridgeContract<
  DiagnosticEventPayload,
  DiagnosticEventMetadata
>;

type PluginInteractiveHandlerResult = {
  handled?: boolean;
} | void;

export type PluginInteractiveRegistration<
  TContext = unknown,
  TChannel extends string = string,
  TResult = PluginInteractiveHandlerResult,
> = {
  channel: TChannel;
  namespace: string;
  handler: (ctx: TContext) => Promise<TResult> | TResult;
};

export type PluginInteractiveHandlerRegistration = PluginInteractiveRegistration;

export type CarapacePluginHttpRouteAuth = "gateway" | "plugin";
export type CarapacePluginHttpRouteMatch = "exact" | "prefix";
export type CarapacePluginGatewayRuntimeScopeSurface = "write-default" | "trusted-operator";

export type CarapacePluginHttpRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean | void> | boolean | void;

export type CarapacePluginHttpRouteUpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => Promise<boolean | void> | boolean | void;

export type CarapacePluginHttpRouteParams = {
  path: string;
  handler: CarapacePluginHttpRouteHandler;
  handleUpgrade?: CarapacePluginHttpRouteUpgradeHandler;
  auth: CarapacePluginHttpRouteAuth;
  match?: CarapacePluginHttpRouteMatch;
  gatewayRuntimeScopeSurface?: CarapacePluginGatewayRuntimeScopeSurface;
  nodeCapability?: {
    surface: string;
    ttlMs?: number;
  };
  replaceExisting?: boolean;
};

export type CarapacePluginHostedMediaResolver = (
  mediaUrl: string,
) => string | null | undefined | Promise<string | null | undefined>;

export type WidgetPresenterContext = Readonly<{
  messageChannel?: string;
  accountId?: string;
  deliveryContext?: Readonly<DeliveryContext>;
  nativeChannelId?: string;
  currentChannelId?: string;
  currentMessagingTarget?: string;
  sessionKey?: string;
}>;

export type WidgetPresenterDocument = Readonly<{
  kind: "html";
  html: string;
  hostedUrl?: string;
}>;

export type WidgetPresentationError =
  | { code: "no_eligible_node"; message: string }
  | { code: "node_error"; message: string; nodeId?: string }
  | { code: "unavailable"; message: string }
  | { code: "presentation_error"; message: string };

export type WidgetPresentationSuccess =
  | { kind: "node"; nodeId: string; nodeName?: string }
  | { kind: "message"; receipt: MessageReceipt };

type WidgetPresenterBase = {
  description: string;
  availability: (
    context: WidgetPresenterContext,
  ) => Promise<Result<{ available: true }, WidgetPresentationError>>;
  present: (params: {
    document: WidgetPresenterDocument;
    title: string;
    context: WidgetPresenterContext;
  }) => Promise<Result<WidgetPresentationSuccess, WidgetPresentationError>>;
};

export type WidgetPresenter = WidgetPresenterBase &
  (
    | {
        target: "node_panel";
        match?: never;
        capabilities?: never;
      }
    | {
        target: "current_channel";
        match: (context: WidgetPresenterContext) => boolean;
        capabilities: Readonly<{
          sourceKinds: readonly string[];
          maxSourceBytes?: number;
        }>;
      }
  );

export type CarapacePluginCliContext = {
  /**
   * Command object where this plugin should register its commands.
   *
   * For root CLI registrations this is the root `carapace` program. For nested
   * registrations it is the resolved parent command from `parentPath`.
   */
  program: Command;
  parentPath: readonly string[];
  config: CarapaceConfig;
  workspaceDir?: string;
  logger: PluginLogger;
};

export type CarapacePluginCliRegistrar = (ctx: CarapacePluginCliContext) => void | Promise<void>;

/**
 * Top-level CLI metadata for plugin-owned commands.
 *
 * Descriptors are the parse-time contract for lazy plugin CLI registration.
 * If you want Carapace to keep a plugin command lazy-loaded while still
 * advertising it at the root CLI level, provide descriptors that cover every
 * top-level command root registered by that plugin CLI surface.
 */
type CarapacePluginCliCommandDescriptor = {
  name: string;
  description: string;
  hasSubcommands: boolean;
};

/** Root-command metadata that is available before a plugin registrar is activated. */
export type CarapacePluginCliRootCommandDescriptor = CarapacePluginCliCommandDescriptor & {
  machineOutput?: (params: { argv: readonly string[]; stdoutIsTTY: boolean }) => boolean;
};

type CarapacePluginRootCliRegistrationOptions = {
  /** Omit or pass an empty path for root commands. */
  parentPath?: readonly [];
  commands?: readonly string[];
  descriptors?: readonly CarapacePluginCliRootCommandDescriptor[];
};

/** Backward-compatible registration shape for dynamic root or nested paths. */
type CarapacePluginLegacyCliRegistrationOptions = {
  parentPath?: readonly string[];
  commands?: readonly string[];
  descriptors?: readonly CarapacePluginCliCommandDescriptor[];
};

export type CarapacePluginCliRegistrationOptions =
  | CarapacePluginRootCliRegistrationOptions
  | CarapacePluginLegacyCliRegistrationOptions;

export type CarapacePluginNodeCliFeatureOptions = {
  /** Explicit node feature command names owned under `carapace nodes`. */
  commands?: string[];
  /**
   * Parse-time command descriptors for lazy node feature CLI registration.
   *
   * Descriptors are registered under `carapace nodes`, so a descriptor named
   * `"camera"` exposes `carapace nodes camera`.
   */
  descriptors?: CarapacePluginCliCommandDescriptor[];
};

export type CarapacePluginReloadRegistration = {
  restartPrefixes?: string[];
  hotPrefixes?: string[];
  noopPrefixes?: string[];
};

export type {
  CarapacePluginNodeHostCommand,
  CarapacePluginNodeHostCommandAvailabilityContext,
  CarapacePluginNodeHostCommandIo,
} from "./types.node-host.js";

export type CarapacePluginNodeInvokeTransportResult =
  | {
      ok: true;
      payload?: unknown;
      payloadJSON?: string | null;
    }
  | {
      ok: false;
      code?: string;
      message: string;
      details?: Record<string, unknown>;
    };

type CarapacePluginNodeInvokeApprovalDecision = "allow-once" | "allow-always" | "deny";

type CarapacePluginNodeInvokePolicyApprovalRuntime = {
  request: (input: {
    title: string;
    description: string;
    scope?: ApprovalScope;
    severity?: "info" | "warning" | "critical";
    toolName?: string;
    toolCallId?: string;
    agentId?: string;
    sessionKey?: string;
    allowedDecisions?: readonly CarapacePluginNodeInvokeApprovalDecision[];
    timeoutMs?: number;
  }) => Promise<{
    id?: string;
    decision?: CarapacePluginNodeInvokeApprovalDecision | null;
  }>;
};

export type CarapacePluginNodeInvokePolicyContext = {
  nodeId: string;
  command: string;
  params: unknown;
  timeoutMs?: number;
  idempotencyKey?: string;
  config: CarapaceConfig;
  pluginConfig?: Record<string, unknown>;
  node?: {
    nodeId: string;
    displayName?: string;
    platform?: string;
    deviceFamily?: string;
    commands?: string[];
  };
  client?: {
    connId?: string;
    scopes?: string[];
  } | null;
  risk?: {
    level: "ordinary" | "high";
    /** Stable, content-free family name; never include user or action arguments. */
    family: string;
  };
  approvals?: CarapacePluginNodeInvokePolicyApprovalRuntime;
  /** Full covers only the selected harness's declared node commands; undefined requires a human decision. */
  invokeNodeWithSessionFull?: (input: {
    workspace: CarapacePluginNodeWorkspace;
    /** Called only after the host authorizes this exact admitted Full launch. */
    createParams: () => unknown;
  }) => Promise<CarapacePluginNodeInvokeTransportResult | undefined>;
  invokeNode: (input?: {
    params?: unknown;
    /** Bind an approved launch to its admitted managed workspace, when present. */
    workspace?: CarapacePluginNodeWorkspace;
    timeoutMs?: number;
    idempotencyKey?: string;
  }) => Promise<CarapacePluginNodeInvokeTransportResult>;
};

export type CarapacePluginNodeInvokePolicyResult =
  | {
      ok: true;
      payload?: unknown;
      payloadJSON?: string | null;
    }
  | {
      ok: false;
      message: string;
      code?: string;
      details?: Record<string, unknown>;
      unavailable?: boolean;
    };

export type CarapacePluginNodeInvokePolicy = {
  commands: string[];
  /**
   * Platforms where these node-handled commands should be allowlisted by default.
   * Omit for commands that require explicit `gateway.nodes.commands.allow`.
   */
  defaultPlatforms?: Array<"ios" | "android" | "macos" | "windows" | "linux" | "unknown">;
  /**
   * Dangerous policy commands are filtered out of default allowlists unless
   * explicitly allowed by config.
   */
  dangerous?: boolean;
  /**
   * Explicitly permits one approval to cover later launches on the same managed placement.
   * The scope is a stable semantic capability key, never user or action arguments.
   */
  standingApproval?: {
    kind: "placement";
    scope: string;
  };
  /**
   * iOS foreground-restricted commands should be queued for foreground delivery
   * when an iOS node reports BACKGROUND_UNAVAILABLE.
   */
  foregroundRestrictedOnIos?: boolean;
  /**
   * Classify exact command arguments before the policy handler or node transport runs.
   * Throwing rejects the invocation before dispatch.
   */
  classifyRisk?: (
    ctx: Pick<CarapacePluginNodeInvokePolicyContext, "command" | "params">,
  ) => NonNullable<CarapacePluginNodeInvokePolicyContext["risk"]>;
  handle: (
    ctx: CarapacePluginNodeInvokePolicyContext,
  ) => Promise<CarapacePluginNodeInvokePolicyResult> | CarapacePluginNodeInvokePolicyResult;
};

export type CarapacePluginSecurityAuditContext = {
  config: CarapaceConfig;
  sourceConfig: CarapaceConfig;
  env: NodeJS.ProcessEnv;
  stateDir: string;
  configPath: string;
};

export type CarapacePluginSecurityAuditCollector = (
  ctx: CarapacePluginSecurityAuditContext,
) => SecurityAuditFinding[] | Promise<SecurityAuditFinding[]>;

export type CarapaceGatewayDiscoveryAdvertiseContext = {
  machineDisplayName: string;
  gatewayPort: number;
  gatewayTlsEnabled: boolean;
  gatewayTlsFingerprintSha256?: string;
  gatewayDirectReachable: boolean;
  tailnetDns?: string;
  sshPort?: number;
  cliPath?: string;
  minimal: boolean;
};

export type CarapaceGatewayDiscoveryService = {
  id: string;
  advertise: (
    ctx: CarapaceGatewayDiscoveryAdvertiseContext,
  ) => void | Promise<void | { stop?: () => void | Promise<void> }>;
};

/** Context passed to long-lived plugin services. */
export type CarapacePluginServiceHealth = {
  reportFailure: (error: unknown) => void;
  clearFailure: () => void;
};

export type CarapacePluginServiceContext = {
  config: CarapaceConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
  serviceHealth?: CarapacePluginServiceHealth;
  /** Gateway-owned scheduler access, revoked when this service stops. */
  getCron?: () => import("./hook-types.js").PluginHookGatewayCronService | undefined;
  gatewayEvents?: import("./gateway-events.js").CarapacePluginGatewayEvents;
  startupTrace?: {
    detail?: (name: string, metrics: ReadonlyArray<readonly [string, number | string]>) => void;
    measure: <T>(name: string, run: () => T | Promise<T>) => Promise<T>;
  };
  internalDiagnostics?: {
    /** Identity of the hosting process, available only while this service is active. */
    getRuntimeIdentity?: () => { processInstanceId: string; buildId?: string };
    emit: (event: DiagnosticEventInput, privateData?: DiagnosticEventPrivateData) => void;
    onEvent: (
      listener: (
        event: DiagnosticEventPayload,
        metadata: DiagnosticEventMetadata,
        privateData: DiagnosticEventPrivateData,
      ) => void,
      filter?: InternalDiagnosticEventInterest<DiagnosticEventPayload["type"]>,
    ) => () => void;
    registerTracePropagationBridge?: (bridge: DiagnosticTracePropagationBridge) => () => void;
  };
};

/** Background service registered by a plugin during `register(api)`. */
export type CarapacePluginService = {
  id: string;
  /** Restart this service with committed config when one of these paths changes. */
  reload?: { configPrefixes: readonly string[] };
  start: (ctx: CarapacePluginServiceContext) => void | Promise<void>;
  stop?: (ctx: CarapacePluginServiceContext) => void | Promise<void>;
};

export type CarapacePluginChannelRegistration = {
  plugin: ChannelPlugin;
};

/**
 * Public label exposed to plugin `register(api)` calls.
 *
 * Keep this as a compatibility signal for plugin authors. Loader internals
 * should derive explicit capability booleans from the mode instead of branching
 * on raw strings throughout the code path.
 *
 * - `full`: live runtime activation; long-lived side effects may start.
 * - `discovery`: read-only capability discovery; skip sockets/workers/clients.
 * - `tool-discovery`: capability discovery for executable tools; skip channel runtime hydration.
 * - `setup-only`: lightweight channel setup entry only.
 * - `setup-runtime`: setup flow that also needs the runtime channel entry.
 * - `cli-metadata`: CLI command metadata collection.
 */
export type PluginRegistrationMode =
  | "full"
  | "discovery"
  | "tool-discovery"
  | "setup-only"
  | "setup-runtime"
  | "cli-metadata";
