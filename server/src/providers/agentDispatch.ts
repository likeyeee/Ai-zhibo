import { AgentDispatchClient } from 'livekit-server-sdk';
import type { AppConfig } from '../config';
import { liveKitRoomName } from './realtime';
import { livekitApiHost } from './output/livekitEgress';

export interface AgentDispatchApi {
  createDispatch(roomName: string, agentName: string, metadata?: string): Promise<{ id: string }>;
  deleteDispatch(dispatchId: string, roomName: string): Promise<void>;
}

export interface AgentDispatcher {
  dispatchHost(sessionId: string, extra?: Record<string, unknown>): Promise<void>;
  cancelHost(sessionId: string): Promise<void>;
}

const noop: AgentDispatcher = {
  async dispatchHost() {},
  async cancelHost() {},
};

export function createAgentDispatcher(config: AppConfig, api?: AgentDispatchApi): AgentDispatcher {
  if (config.realtimeProvider !== 'livekit' || config.livekitHostPublisher !== 'agent') return noop;
  if (!api && (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret)) return noop;
  const client = api ?? liveKitApi(config);
  return new ExplicitDispatch(client, config.livekitAgentName);
}

function liveKitApi(config: AppConfig): AgentDispatchApi {
  const client = new AgentDispatchClient(livekitApiHost(config.livekitUrl), config.livekitApiKey, config.livekitApiSecret);
  return {
    async createDispatch(roomName, agentName, metadata) {
      const dispatch = await client.createDispatch(roomName, agentName, { metadata });
      return { id: dispatch.id };
    },
    async deleteDispatch(dispatchId, roomName) {
      await client.deleteDispatch(dispatchId, roomName);
    },
  };
}

class ExplicitDispatch implements AgentDispatcher {
  private readonly ids = new Map<string, string>();

  constructor(
    private readonly api: AgentDispatchApi,
    private readonly agentName: string,
  ) {}

  async dispatchHost(sessionId: string, extra: Record<string, unknown> = {}) {
    const room = liveKitRoomName(sessionId);
    try {
      const dispatch = await this.api.createDispatch(
        room,
        this.agentName,
        JSON.stringify({ sessionId, topic: 'lingbo', ...extra }),
      );
      if (dispatch.id) this.ids.set(sessionId, dispatch.id);
    } catch (error) {
      console.error('LiveKit Agent 调度失败，直播继续', error instanceof Error ? error.message : 'dispatch_failed');
    }
  }

  async cancelHost(sessionId: string) {
    const id = this.ids.get(sessionId);
    this.ids.delete(sessionId);
    if (!id) return;
    try {
      await this.api.deleteDispatch(id, liveKitRoomName(sessionId));
    } catch {
      // The room may already be gone.
    }
  }
}
