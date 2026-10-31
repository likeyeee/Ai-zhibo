import { useEffect, useRef } from 'react';
import type { LiveEvent } from '@lingbo/shared';

export function useLiveChannel(sessionId: string | null, onEvent: (event: LiveEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!sessionId) return;
    let socket: WebSocket | null = null;
    let retry = 0;
    let stopped = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/api/live/${sessionId}`);
      socket.onmessage = (message) => {
        try {
          handler.current(JSON.parse(String(message.data)) as LiveEvent);
        } catch {
          // ignore a bad frame and keep the room open
        }
      };
      socket.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 1200);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [sessionId]);
}
