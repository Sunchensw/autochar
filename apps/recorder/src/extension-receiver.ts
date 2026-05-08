import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

export interface ExtensionReceiverInfo {
  receiverUrl: string;
  port: number;
  token: string;
}

export interface ExtensionReceiverServerOptions {
  preferredPort?: number;
  token?: string;
  maxBodyBytes?: number;
  onEvent: (event: unknown) => Promise<void>;
}

export class ExtensionReceiverServer {
  private server?: http.Server;
  private port = 0;
  private readonly tokenValue: string;
  private readonly maxBodyBytes: number;

  constructor(private readonly options: ExtensionReceiverServerOptions) {
    this.tokenValue = options.token ?? randomBytes(16).toString('hex');
    this.maxBodyBytes = options.maxBodyBytes ?? 15 * 1024 * 1024;
  }

  async start(): Promise<ExtensionReceiverInfo> {
    if (this.server) return this.info();
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        this.sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    });
    this.port = await this.listen(this.options.preferredPort ?? 17321);
    return this.info();
  }

  info(): ExtensionReceiverInfo {
    if (!this.server || !this.port) {
      return {
        receiverUrl: '',
        port: 0,
        token: this.tokenValue
      };
    }
    return {
      receiverUrl: `http://127.0.0.1:${this.port}`,
      port: this.port,
      token: this.tokenValue
    };
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.port = 0;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    this.writeCors(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      this.sendJson(response, 200, { ok: true, mode: 'extension-receiver' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/events') {
      this.sendJson(response, 404, { ok: false, error: 'Not found' });
      return;
    }
    if (request.headers['x-autochar-token'] !== this.tokenValue) {
      this.sendJson(response, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    const body = await this.readBody(request);
    let event: unknown;
    try {
      event = JSON.parse(body);
    } catch {
      this.sendJson(response, 400, { ok: false, error: 'Invalid JSON' });
      return;
    }
    await this.options.onEvent(event);
    this.sendJson(response, 200, { ok: true });
  }

  private listen(preferredPort: number): Promise<number> {
    const tryPort = (port: number, attemptsLeft: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const server = this.server!;
        const onError = (error: NodeJS.ErrnoException) => {
          server.off('listening', onListening);
          if (error.code === 'EADDRINUSE' && attemptsLeft > 0 && port !== 0) {
            resolve(tryPort(port + 1, attemptsLeft - 1));
            return;
          }
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
    return tryPort(preferredPort, 10);
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxBodyBytes) {
          reject(new Error('Request body is too large.'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });
  }

  private writeCors(response: ServerResponse) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'content-type,x-autochar-token');
    response.setHeader('Access-Control-Max-Age', '86400');
  }

  private sendJson(response: ServerResponse, status: number, payload: unknown) {
    this.writeCors(response);
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  }
}
