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
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string | Uint8Array): void;
  }

  export type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;

  export interface HttpServer {
    listen(port: number, hostname: string, callback?: () => void): HttpServer;
    listen(port: number, callback?: () => void): HttpServer;
    close(callback?: () => void): HttpServer;
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
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function unlinkSync(path: string): void;
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