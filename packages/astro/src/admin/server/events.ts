/** Server-Sent Events for the admin page. */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type AdminEventName =
  | 'queue'
  | 'photo'
  | 'photo-removed'
  | 'albums'
  | 'error'
  | 'log'
  | 'job'
  | 'settings';

export class EventHub {
  #clients = new Set<ServerResponse>();
  #ping: ReturnType<typeof setInterval> | undefined;
  #pingMs: number;

  constructor(pingMs = 15000) {
    this.#pingMs = pingMs;
  }

  get size(): number {
    return this.#clients.size;
  }

  /** Open a stream. `hello` events go to this client only, right away. */
  open(
    req: IncomingMessage,
    res: ServerResponse,
    hello: Array<[AdminEventName, unknown]>
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    for (const [name, data] of hello) res.write(frame(name, data));
    this.#clients.add(res);
    const drop = () => this.#clients.delete(res);
    req.on('close', drop);
    res.on('close', drop);
    this.#ping ??= setInterval(() => {
      for (const c of this.#clients) c.write(': ping\n\n');
    }, this.#pingMs);
    this.#ping.unref?.();
  }

  send(name: AdminEventName, data: unknown): void {
    if (!this.#clients.size) return;
    const text = frame(name, data);
    for (const c of this.#clients) c.write(text);
  }

  close(): void {
    clearInterval(this.#ping);
    this.#ping = undefined;
    for (const c of this.#clients) c.end();
    this.#clients.clear();
  }
}

function frame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
