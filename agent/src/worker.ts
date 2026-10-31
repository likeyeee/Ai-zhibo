/**
 * LiveKit Agents 主播。
 *
 * API 在 LIVEKIT_HOST_PUBLISHER=agent 时，会把名为 lingbo-host 的 worker
 * 调度进房间 lingbo-<场次 id>。控制台把口播文本发到 data channel，topic 是 lingbo。
 * 配了 LINGBO_TTS_MODEL 时，用 Agents 的 inference TTS 调用 session.say，
 * 声音作为参与者音轨进房间，再由 Egress 合成后推到抖音等平台。
 *
 * 不配 TTS 时 worker 仍然进房，只把口播打到日志，方便确认调度通了。
 * 安装：在 agent/ 里 npm install，然后
 * LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npm run dev
 */
import { cli, defineAgent, inference, voice, WorkerOptions, type JobContext } from '@livekit/agents';
import { RoomEvent } from '@livekit/rtc-node';
import { fileURLToPath } from 'node:url';

const TOPIC = 'lingbo';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const say = await startVoice(ctx);
    ctx.room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (typeof topic === 'string' && topic !== TOPIC) return;
      const packet = decode(payload);
      if (!packet || packet.type !== 'speech' || !packet.text) return;
      if (say) {
        void say(packet.text).catch((error: unknown) => {
          console.error('口播没说出去', error instanceof Error ? error.message : 'say_failed');
        });
        return;
      }
      console.log(`口播 ${packet.text}`);
    });
  },
});

async function startVoice(ctx: JobContext): Promise<((text: string) => Promise<unknown>) | null> {
  const model = process.env.LINGBO_TTS_MODEL?.trim();
  if (!model) return null;
  const session = new voice.AgentSession({
    tts: new inference.TTS({ model, voice: process.env.LINGBO_TTS_VOICE }),
  });
  await session.start({
    agent: new voice.Agent({ instructions: '只朗读收到的口播，不要自己加话。' }),
    room: ctx.room,
  });
  return (text: string) => session.say(text);
}

function decode(payload: Uint8Array): { type?: string; text?: string } | null {
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as { type?: string; text?: string };
  } catch {
    return null;
  }
}

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: process.env.LIVEKIT_AGENT_NAME || 'lingbo-host',
  }),
);
