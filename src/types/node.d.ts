// Hand-rolled ambient declarations for the handful of Node built-ins Carapace uses.
// Purpose: keep devDependencies to `typescript` alone. If the project's type surface
// outgrows this file, replace it with @types/node as a devDependency.

declare module "node:http" {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: "data", listener: (chunk: Uint8Array) => void): IncomingMessage;
    on(event: "end", listener: () => void): IncomingMessage;
    on(event: "error", listener: (error: Error) => void): IncomingMessage;
    on(event: string, listener: (...args: unknown[]) => void): IncomingMessage;
  }

  export interface ServerResponse {
    statusCode: number;
    readonly headersSent: boolean;
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string | Uint8Array): void;
  }

  export type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;

  export interface HttpServer {
    listen(port: number, hostname: string, callback?: () => void): HttpServer;
    listen(port: number, callback?: () => void): HttpServer;
    close(callback?: () => void): HttpServer;
    closeAllConnections(): void;
    address(): { port: number; family: string; address: string } | string | null;
    on(event: "error", listener: (error: Error) => void): HttpServer;
    on(event: string, listener: (...args: unknown[]) => void): HttpServer;
    off(event: "error", listener: (error: Error) => void): HttpServer;
    off(event: string, listener: (...args: unknown[]) => void): HttpServer;
  }

  export function createServer(listener: RequestListener): HttpServer;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string | Uint8Array, encoding?: string): void;
  export function unlinkSync(path: string): void;
  export function readdirSync(path: string): string[];
  export function realpathSync(path: string): string;
  export interface Stats {
    isDirectory(): boolean;
    isFile(): boolean;
    size: number;
  }
  export function statSync(path: string): Stats;
}

declare module "node:path" {
  export const sep: string;
  export function join(...segments: string[]): string;
  export function resolve(...segments: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
}

declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
  export function platform(): string;
  export const EOL: string;
}

declare module "node:sqlite" {
  export interface RunResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export interface StatementSync {
    run(...params: Array<string | number | bigint | null>): RunResult;
    get(...params: Array<string | number | bigint | null>): unknown;
    all(...params: Array<string | number | bigint | null>): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

interface ConsoleLike {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
}

interface ProcessLike {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
  exitCode?: number;
  version: string;
  platform: string;
  pid: number;
  cwd(): string;
  stdout: { write(data: string): boolean };
  stderr: { write(data: string): boolean };
  on(event: string, listener: (...args: unknown[]) => void): void;
}

declare var console: ConsoleLike;
declare var process: ProcessLike;

declare class TextDecoder {
  constructor(encoding?: string);
  readonly encoding: string;
  decode(input?: Uint8Array | ArrayBuffer, options?: { stream?: boolean }): string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

// --- crypto (constant-time secret comparison) ---

declare module "node:crypto" {
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

// --- timers ---

declare function setTimeout(handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]): unknown;
declare function clearTimeout(id: unknown): void;

// --- fetch stack (Node >= 18 globals) ---

declare class AbortSignal {
  static timeout(milliseconds: number): AbortSignal;
  readonly aborted: boolean;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
}

declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}

declare class URL {
  constructor(input: string | URL, base?: string | URL);
  readonly href: string;
  readonly protocol: string;
  readonly host: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly search: string;
  toString(): string;
}

interface ResponseHeaders {
  get(name: string): string | null;
}

interface Response {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: ResponseHeaders;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

declare function fetch(input: string | URL, init?: RequestInit): Promise<Response>;

// --- child processes ---

declare module "node:child_process" {
  export interface Readable {
    on(event: "data", listener: (chunk: string | Uint8Array) => void): Readable;
    on(event: "end", listener: () => void): Readable;
    on(event: "error", listener: (error: Error) => void): Readable;
    setEncoding(encoding: "utf8" | "utf-8"): Readable;
  }

  export interface ChildProcess {
    stdout: Readable | null;
    stderr: Readable | null;
    on(event: "close", listener: (code: number | null, signal: string | null) => void): ChildProcess;
    on(event: "error", listener: (error: Error) => void): ChildProcess;
    on(event: string, listener: (...args: unknown[]) => void): ChildProcess;
    kill(signal?: string): boolean;
  }

  export interface SpawnOptions {
    shell?: boolean | string;
    cwd?: string;
    timeout?: number;
    killSignal?: string;
    env?: Record<string, string | undefined>;
  }

  export function spawn(command: string, options?: SpawnOptions): ChildProcess;
}