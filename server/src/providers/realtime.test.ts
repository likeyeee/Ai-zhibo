import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { LiveKitRealtime, createRealtime, liveKitRoomName, mintPublisherToken } from './realtime';

describe('realtime provider', () => {
  it('stays local when LiveKit is not configured', async () => {
    const provider = createRealtime(loadConfig({ REALTIME_PROVIDER: 'livekit' }));
    expect(provider.id).toBe('local');
    const join = await provider.join({ sessionId: 's1', role: 'viewer', identity: 'viewer-1', name: '晚风' });
    expect(join.provider).toBe('local');
    expect(join.token).toBeNull();
  });

  it('signs a host token that can publish and a viewer token that cannot', async () => {
    const config = loadConfig({
      REALTIME_PROVIDER: 'livekit',
      LIVEKIT_URL: 'ws://localhost:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'secret',
    });
    const provider = new LiveKitRealtime(config);
    const host = await provider.join({ sessionId: 'room-1', role: 'host', identity: 'host', name: '小林' });
    const viewer = await provider.join({ sessionId: 'room-1', role: 'viewer', identity: 'viewer-a', name: '晚风' });

    expect(host.provider).toBe('livekit');
    expect(host.room).toBe(liveKitRoomName('room-1'));
    expect(host.publishMedia).toBe(true);
    expect(viewer.publishMedia).toBe(false);
    expect(grants(host.token ?? '')).toMatchObject({ room: 'lingbo-room-1', roomJoin: true, canPublish: true, canPublishData: true });
    expect(grants(viewer.token ?? '').canPublish).toBe(false);
    expect(JSON.parse(Buffer.from((host.token ?? '').split('.')[1] ?? '', 'base64url').toString()).sub).toBe('host');
  });

  it('asks the browser not to publish when an external agent owns the host', async () => {
    const provider = new LiveKitRealtime(
      loadConfig({
        REALTIME_PROVIDER: 'livekit',
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'secret',
        LIVEKIT_HOST_PUBLISHER: 'agent',
      }),
    );
    const host = await provider.join({ sessionId: 'room-2', role: 'host', identity: 'host', name: '小林' });
    expect(host.publishMedia).toBe(false);
    expect(grants(host.token ?? '').canPublish).toBe(false);
    expect(grants(host.token ?? '').canPublishData).toBe(true);
    expect(host.hostPublisher).toBe('agent');
  });

  it('lets the local digital human publish while the browser stays a viewer', async () => {
    const config = loadConfig({
      REALTIME_PROVIDER: 'livekit',
      LIVEKIT_URL: 'ws://localhost:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'secret',
      LIVEKIT_HOST_PUBLISHER: 'lingbo',
    });
    const provider = new LiveKitRealtime(config);
    const host = await provider.join({ sessionId: 'room-3', role: 'host', identity: 'host', name: '小林' });
    expect(host.publishMedia).toBe(false);
    expect(host.hostPublisher).toBe('lingbo');
    expect(grants(host.token ?? '').canPublish).toBe(false);
    const publisher = await mintPublisherToken(config, 'room-3');
    expect(grants(publisher ?? '').canPublish).toBe(true);
    expect(JSON.parse(Buffer.from((publisher ?? '').split('.')[1] ?? '', 'base64url').toString()).sub).toBe('lingbo-avatar');
  });
});

function grants(token: string): { room: string; roomJoin: boolean; canPublish: boolean; canPublishData: boolean } {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
    video: { room: string; roomJoin: boolean; canPublish: boolean; canPublishData: boolean };
  };
  return payload.video;
}
