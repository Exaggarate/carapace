// Minimal HTTP gateway surface (node:http, zero dependencies).
// M0: GET /health, a GET / index, and the exact-match route table that channel
// endpoints mount onto. Pattern routing arrives with channel work in M1+.

import { createServer } from "node:http";
import type { HttpServer, IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { VERSION } from "../version.js";

export type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

export class RouteTable {
  private readonly entries = new Map<string, RouteHandler>();

  add(method: string, path: string, handler: RouteHandler): this {
    this.entries.set(`${method.toUpperCase()} ${path}`, handler);
    return this;
  }

  match(method: string, path: string): RouteHandler | undefined {
    return this.entries.get(`${method.toUpperCase()} ${path}`);
  }

  list(): string[] {
    return [...this.entries.keys()].sort();
  }
}

export function respondJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

export interface GatewayServerOptions {
  host: string;
  port: number;
  routes?: RouteTable;
}

export interface GatewayHandle {
  server: HttpServer;
  host: string;
  port: number;
  routes: RouteTable;
  stop(): Promise<void>;
}

export async function startGatewayServer(options: GatewayServerOptions): Promise<GatewayHandle> {
  const routes = options.routes ?? new RouteTable();
  const startedAt = Date.now();

  const listener: RequestListener = (request, response) => {
    const method = (request.method ?? "GET").toUpperCase();
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (method === "GET" && (path === "/health" || path === "/health/")) {
      respondJson(response, 200, {
        ok: true,
        service: "carapace",
        version: VERSION,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        node: process.version,
      });
      return;
    }
    if (method === "GET" && (path === "/" || path === "/index.html")) {
      respondJson(response, 200, {
        service: "carapace",
        version: VERSION,
        endpoints: ["/health", ...routes.list()],
      });
      return;
    }
    const handler = routes.match(method, path);
    if (handler !== undefined) {
      // A handler that throws must still end the response — never leave a socket open.
      void Promise.resolve(handler(request, response)).catch((error: unknown) => {
        if (response.headersSent) {
          response.end();
          return;
        }
        respondJson(response, 500, { error: "internal_error", detail: (error as Error).message });
      });
      return;
    }
    respondJson(response, 404, { error: "not_found", path });
  };

  const server = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.on("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : options.port;

  return {
    server,
    host: options.host,
    port: boundPort,
    routes,
    stop: async (): Promise<void> => {
      // Force-close lingering sockets (idle keep-alives, stuck clients) so a
      // shutdown or test teardown can never hang on server.close().
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}