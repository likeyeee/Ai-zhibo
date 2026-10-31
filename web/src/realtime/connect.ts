import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { LIVEKIT_TOPIC, type RealtimeDataPacket, type RealtimeJoin } from '@lingbo/shared';

export interface LiveKitHandle {
  publishCamera(track: MediaStreamTrack): Promise<void>;
  publishMicrophone(track: MediaStreamTrack): Promise<void>;
  publishPacket(packet: RealtimeDataPacket): Promise<void>;
  disconnect(): Promise<void>;
}

export async function connectLiveKit(
  join: RealtimeJoin,
  onPacket: (packet: RealtimeDataPacket) => void,
  onTrack: (kind: 'audio' | 'video', track: RemoteTrack) => void,
): Promise<LiveKitHandle> {
  if (join.provider !== 'livekit' || !join.url || !join.token) throw new Error('not livekit');
  const room = new Room({ adaptiveStream: true, dynacast: true });
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Video) onTrack('video', track);
    if (track.kind === Track.Kind.Audio) onTrack('audio', track);
  });
  room.on(RoomEvent.DataReceived, (payload, participant, ...rest) => {
    const topic = rest[1];
    if (typeof topic === 'string' && topic !== LIVEKIT_TOPIC) return;
    if (participant?.identity === room.localParticipant.identity) return;
    const packet = decodePacket(payload);
    if (packet) onPacket(packet);
  });
  await room.connect(join.url, join.token);
  return {
    async publishCamera(track) {
      await room.localParticipant.publishTrack(track, { name: 'lingbo-camera', source: Track.Source.Camera });
    },
    async publishMicrophone(track) {
      await room.localParticipant.publishTrack(track, { name: 'lingbo-voice', source: Track.Source.Microphone });
    },
    async publishPacket(packet) {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(packet)), {
        reliable: true,
        topic: LIVEKIT_TOPIC,
      });
    },
    async disconnect() {
      await room.disconnect();
    },
  };
}

function decodePacket(payload: Uint8Array): RealtimeDataPacket | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as RealtimeDataPacket;
    if (parsed.v !== 1 || (parsed.type !== 'comment' && parsed.type !== 'speech') || typeof parsed.text !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
