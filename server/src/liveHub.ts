import type { WebSocket } from 'ws';
import type { LiveEvent } from '@lingbo/shared';

type Tap = (sessionId: string, event: LiveEvent) => void;

export class LiveHub {
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private readonly taps = new Set<Tap>();

  addSocket(sessionId: string, socket: WebSocket) {
    const room = this.sockets.get(sessionId) ?? new Set<WebSocket>();
    room.add(socket);
    this.sockets.set(sessionId, room);
    this.publish(sessionId, { type: 'presence', connections: room.size });
  }

  removeSocket(sessionId: string, socket: WebSocket) {
    const room = this.sockets.get(sessionId);
    if (!room) return;
    room.delete(socket);
    if (room.size === 0) this.sockets.delete(sessionId);
    this.publish(sessionId, { type: 'presence', connections: room.size });
  }

  connections(sessionId: string): number {
    return this.sockets.get(sessionId)?.size ?? 0;
  }

  publish(sessionId: string, event: LiveEvent) {
    const payload = JSON.stringify(event);
    for (const socket of this.sockets.get(sessionId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
    for (const tap of this.taps) tap(sessionId, event);
  }

  tap(listener: Tap): () => void {
    this.taps.add(listener);
    return () => this.taps.delete(listener);
  }
}
