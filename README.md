# 灵播

用 AI 数字人开一场直播带货，并把这一路画面推到抖音、快手、哔哩哔哩、视频号、TikTok 这类平台。商家维护商品和人设，主播按资料口播、轮换商品，并回答观众。仓库里的直播间只用来预览和试评论，不是观众入口。

界面默认简体中文，右上角可以切到英文。文案集中在 `web/src/i18n/`，加一种语言就是再放一份同样键名的字典。

## 技术选型

前后端都用 TypeScript，领域类型放在 `shared/`，避免接口两边各写一遍。

- **React + Vite**：直播间要持续画口型、接实时事件，用组件状态比服务端模板直接。
- **Fastify**：HTTP 和 WebSocket 在同一个进程里，直播控制面比较轻。
- **JSON 文件**：商品、场次和评论落在 `server/data/db.json`。没有原生数据库依赖，换存储时只改 `JsonStore`。
- **提供者接口**：话术、语音、形象、实时通道都可以换。不配密钥时全部走本地模拟，克隆下来就能把主流程跑通。

实时层、数字人参与者和对外推流都围绕 [LiveKit](https://github.com/livekit/livekit) 来做，而不是再写一套 WebRTC。场次节奏（写话术、轮播、回复评论）仍由本仓库的导播循环负责。没有 LiveKit、也没有推流地址时，预览、口播和评论照样能跑完。见下文「LiveKit 在这里做什么」。

## 功能

- 商品：名称、价格、图片、卖点、常见问题。可上传图片，也可以载入三件示例。
- 话术：按商品资料和语气生成口播。默认是本地模板；配置了兼容 OpenAI 的接口就改走模型，失败会退回模板。
- 数字人：内置矢量主播，嘴型跟着当前这句话动。可改成循环视频。
- 预览间：看主播、商品卡和公屏。评论会进入队列，主播在下一小段之前回答。
- 平台推流：每个平台一条目的地（服务器地址 + 串流密钥）。开播后合成数字人画面和商品字幕，用 FFmpeg 或 LiveKit Egress 推 RTMP/RTMPS。控制台能看连接、推流中、重连和失败。
- 平台评论：只收你自己服务器上的回调，不抓平台的私有接口。
- 控制台：选轮播顺序、预览话术、开播和结束、看评论和简单统计。

## 环境

Node.js 20 或以上。语音和形象的真实服务是可选的。LiveKit 也是可选的，需要 Docker 时再装。

## 跑起来

```bash
npm install
npm test
npm run dev
```

- 控制台和观众页：<http://localhost:5173>
- API：<http://localhost:8787>

`npm run dev` 会同时启动 API 和页面。页面通过 Vite 把 `/api` 和 `/uploads` 转到 API。

只跑一个进程时，先构建页面再启动 API，然后打开 8787 端口：

```bash
npm run build
npm start
```

### 走一遍主流程

1. 打开「商品」，新建一件，或点「载入示例」。
2. 回到「控制台」，勾选要讲的商品，可以先「预览话术」。
3. 「开始直播」。主播会按话术一句句说，字幕和口型一起动。默认不连平台，推流状态是模拟。
4. 「打开观众直播间」看预览，发一条评论，例如示例红茶的「保质期多久」。这一小段讲完后，主播会按商品资料回答。
5. 要试真实推流，先按下文起本地 RTMP，再把 `OUTPUT_PROVIDER` 改成 `ffmpeg`。

勾选「用浏览器朗读」后，这台电脑会用系统中文语音把字幕读出来。这是没有接入 TTS 服务时的本地声音，不会进入 LiveKit 音轨。

数据在 `server/data/`。删掉这个目录就回到空库。

## 环境变量

复制 `.env.example` 为仓库根目录的 `.env`。留空的密钥都会退回本地实现。

| 变量 | 作用 |
| --- | --- |
| `HOST` / `PORT` | API 监听地址，默认 `0.0.0.0:8787` |
| `WEB_ORIGIN` | 浏览器直连 API 时允许的来源 |
| `DATA_DIR` | 数据目录，默认 `server/data` |
| `LLM_PROVIDER` | `mock` 或 `openai`。后者任何兼容 Chat Completions 的地址都可以 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 模型接口 |
| `TTS_PROVIDER` | `mock` 或 `http` |
| `TTS_HTTP_URL` / `TTS_API_KEY` | 语音服务 |
| `AVATAR_PROVIDER` | `local` 或 `video` |
| `AVATAR_VIDEO_URL` | 循环视频地址 |
| `SIMULATE_VIEWERS` | 开播后是否自动丢演示评论 |
| `SIMULATE_INTERVAL_MS` | 演示评论间隔 |
| `SPEECH_PAUSE_SCALE` | 口播停顿倍率，`1` 为正常 |
| `REALTIME_PROVIDER` | `local` 或 `livekit` |
| `LIVEKIT_URL` | 例如 `ws://localhost:7880` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | 只放在服务端，用来签发进房令牌 |
| `LIVEKIT_HOST_PUBLISHER` | `browser` 或 `agent` |
| `LIVEKIT_AGENT_NAME` | Agent worker 的名字，默认 `lingbo-host` |
| `OUTPUT_PROVIDER` | `mock`、`ffmpeg` 或 `livekit` |
| `PROGRAM_BASE_URL` | Egress 打开播出页用的根地址，例如 `http://host.docker.internal:5173` |
| `OUTPUT_FONT` | FFmpeg 字幕字体。不填则自动找文泉驿或 Droid |
| `OUTPUT_SECRET` | 加密串流密钥。不填则在数据目录写 `output.key` |
| `INGEST_TOKEN` | 平台评论回调令牌。不填则拒绝所有回调 |

## LiveKit 在这里做什么

LiveKit 是开源 SFU。选它做底座，是因为数字人直播要的几件事它已经分成了能单独替换的服务，而不是一个只能看的播放器：

- **Server**（[livekit/livekit](https://github.com/livekit/livekit)）转发房间里的音视频。房间名是 `lingbo-<场次 id>`。浏览器和 Agent 都进这一个房间。
- **服务端 SDK**（`livekit-server-sdk`）只在 API 进程里签发进房令牌、调度 Agent、创建 Ingress、让 Egress 开始推流。密钥不下发到浏览器。
- **浏览器 SDK**（`livekit-client`）负责控制台推导播画面、预览间播放、以及 topic `lingbo` 的 data channel。
- **Agents**（[livekit/agents](https://github.com/livekit/agents)）是独立 worker，不是 API 里的一个函数。它进房之后才有麦克风和（可选的）形象，适合接正式 TTS。见 `agent/`。
- **Egress** 用无头 Chrome 打开本仓库的播出页 `/program/<场次 id>`，把数字人、字幕和商品卡合成一路画面，再按 RTMP/RTMPS 推到一个或多个平台。这是对外播出的主路径。
- **Ingress** 把外部编码器的 RTMP 拉进同一个房间，身份是 `avatar-source`。数字人供应商如果只会出一路 RTMP，就从这里进房间，再由 Egress 推出去。

没有 LiveKit 时，`REALTIME_PROVIDER=local`，预览间用内置矢量主播和 WebSocket。`OUTPUT_PROVIDER=mock` 时推流只记状态，不连外网。`OUTPUT_PROVIDER=ffmpeg` 时不需要 LiveKit，本机用 FFmpeg 把商品名、价格和当前口播画成 1280×720 再推 RTMP，断线会按 1 秒、2 秒、4 秒退避重连，最长 15 秒。

```text
导播循环 ──口播/评论──► data channel topic lingbo
                │
                ├─ 浏览器或 Agents 把音视频推进房间 lingbo-<场次>
                │
                └─ Egress 打开 /program/<场次> 合成画面
                         │
                         └─ RTMP/RTMPS ──► 抖音 / 快手 / B站 / 视频号 / TikTok / 本地 MediaMTX
```

播出页会在准备好时向控制台打 `START_RECORDING` / `END_RECORDING`，这是 Egress 自定义模板的约定。

### 用 Docker 起 LiveKit

开发密钥是 `devkey` / `secret`。这一组里有 Redis 和 Egress，推流需要它们。只想试浏览器进房、暂时不推 RTMP 时，也可以只用下面的单容器命令。

```bash
docker compose -f docker-compose.livekit.yml up
```

只起信令、不启 Egress：

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev --bind 0.0.0.0 --node-ip 127.0.0.1
```

端口：

- `7880/tcp`：信令和 HTTP API。浏览器连 `ws://localhost:7880`
- `7881/tcp`：媒体的 TCP 兜底
- `7882/udp`：媒体本身

`deploy/livekit.yaml` 里的 `node_ip: 127.0.0.1` 给「浏览器和 Docker 在同一台机器」用，让 ICE 指向本机。换一台机器访问时，改成那台机器能访问到的 IP。

`.env`：

```bash
REALTIME_PROVIDER=livekit
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_HOST_PUBLISHER=browser
OUTPUT_PROVIDER=livekit
PROGRAM_BASE_URL=http://host.docker.internal:5173
```

重启 `npm run dev`。开播后保持控制台开着：浏览器导播会把画面推进房间。Egress 打开播出页，把远程画面（没有远程画面时用内置主播）和商品卡合成后推到已启用的目的地。页脚会显示「实时通道 · LiveKit」和「播出 · LiveKit Egress」。

连不上 LiveKit 时，预览间留在本地画面。`OUTPUT_PROVIDER=livekit` 但没填密钥时，播出退回模拟，页脚会提示外部服务还没配好。

### 浏览器各自做什么

| 角色 | 令牌权限 | 行为 |
| --- | --- | --- |
| 控制台 `host` | 可推流、可发数据 | 采集导播画面；有 TTS 音频地址时把那段音频推进麦克风轨 |
| 预览间观众 | 只订阅、可发数据 | 播放主播轨；评论同时走 data channel 和 HTTP |
| 播出页 | Egress 自己签发的令牌 | 合成要推到平台的那一路画面 |

本地模拟语音没有音频文件，所以 LiveKit 音轨里不一定有人声。预览间仍可用「用浏览器朗读」。HTTP TTS 返回 `audioUrl` 之后，导播台会把该音频推进房间。

Data channel 的 topic 是 `lingbo`。包体：

```json
{ "v": 1, "type": "speech", "text": "家人们好", "purpose": "script", "durationMs": 2200, "productId": "…" }
{ "v": 1, "type": "comment", "clientId": "…", "name": "晚风", "text": "多少钱" }
```

评论仍会 `POST` 到 API，导播循环才能生成回复。`clientId` 用来把 data channel 上的同一条评论和库里的记录合成一条。

### 用 Agent 当主播

Agents 不嵌进 API 进程：它要常驻，还要带语音插件。API 只在 `LIVEKIT_HOST_PUBLISHER=agent` 时调用 AgentDispatch，把名为 `lingbo-host` 的 worker 派进当前房间。

```bash
cd agent
npm install
LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npm run dev
```

worker 订阅 `lingbo` 上的 `type: "speech"`。设置 `LINGBO_TTS_MODEL`（LiveKit Inference 的模型名，例如 `cartesia/sonic-3`）后，它会 `session.say(text)`，把声音推进房间。火山、阿里云、Azure 等插件按 [Agents 文档](https://docs.livekit.io/agents/)安装。灵播不代签这些语音服务的密钥。

没配 TTS 时 worker 只把口播打到日志，用来确认调度是通的。控制台在 agent 模式下不再采集摄像头，避免两路主播叠在一起。

### 把外部画面送进房间

数字人供应商如果提供的是 RTMP，而不是浏览器画面：开播后 `POST /api/sessions/:id/ingress`。LiveKit Ingress 会返回一个 RTMP 地址和串流密钥，把编码器指过去，参与者身份是 `avatar-source`。播出页优先显示房间里的远程画面。没配 LiveKit 时这个接口返回 `livekit_required`，预览不受影响。

令牌在服务端签发，浏览器拿不到 API secret。房间会在第一个人加入时由 LiveKit 创建。

## 推到抖音和其他平台

控制台的「平台推流」可以加多条目的地。每条有平台、名称、服务器地址、串流密钥，以及「开播时推流」。密钥用 AES-256-GCM 存在 `db.json` 里，接口只回最后四位。日志里的推流地址也会把密钥打成 `***`。

服务器地址用 `rtmp://` 或 `rtmps://`。密钥另填时，会接到地址路径后面。有的平台把签名放在密钥的查询串里（`stream-1?expire=…&sign=…`），原样保存，不会把 `?` 编掉。也可以只填一条已经带密钥的完整地址，密钥留空。

开播后：

- `OUTPUT_PROVIDER=mock`（默认）：状态是「模拟推流」，不连接平台。
- `OUTPUT_PROVIDER=ffmpeg`：每个目的地一个 ffmpeg 进程，画面是中文商品名、价格和当前口播，带一条静音音轨，封装 FLV。进程异常退出会重连。
- `OUTPUT_PROVIDER=livekit`：一个 Room Composite Egress，`customBaseUrl` 指向 `/program/<场次 id>`，`StreamOutput` 里放所有已启用的地址。某一路失败时 Egress 自己会重试；整次 Egress 失败则灵播按同样的退避再起一次。

改目的地或点「重新推流」会停掉当前输出再按新名单启动。结束直播会停掉全部推流。

### 本地 RTMP 试推流

```bash
docker compose -f docker-compose.rtmp.yml up
```

MediaMTX 监听 `1935`。在控制台点「填入本地测试地址」，或自己填：

- 服务器 `rtmp://127.0.0.1:1935/live`
- 串流密钥 `preview`
- 勾选开播时推流

`.env` 设 `OUTPUT_PROVIDER=ffmpeg`，本机需要有 `ffmpeg`。开播后用浏览器打开 <http://localhost:8888/live/preview> 看这一路。这只证明推流链路，不经过抖音。

### 抖音推流地址从哪来

抖音开放平台没有对普通应用公开「查询我的 RTMP 地址」这种接口。地址在开播工具里发给主播：

1. 打开电脑端 **抖音直播伴侣**，登录要开播的账号。
2. 选择直播分类，在开播设置里找到 **推流地址**（有的版本叫服务器）和 **串流密钥**。
3. 把服务器填进灵播的服务器地址，密钥填进串流密钥。地址一般是 `rtmp://` 或 `rtmps://`，主机名里常有 `douyincdn`。
4. 先在伴侣里开始直播（或按它的说明进入待推流），再在灵播里开播。密钥有时效，过期要重新复制。

企业直播中台如果签了合同，地址可能由对方接口下发。那仍然是填进同一条目的地，灵播不去调用未公开的取流接口。

其他平台同样是在官方开播工具里复制地址，而不是从网页里扒：

| 平台 | 推流地址从哪看 | 评论 |
| --- | --- | --- |
| 抖音 | 直播伴侣的服务器和串流密钥 | 见下一节。开放平台的直播间数据要单独申请 |
| 快手 | 快手直播伴侣或创作者服务里的推流地址和串流码 | 弹幕推送属于直播小玩法，要审核通过后才有官方回调 |
| 哔哩哔哩 | 直播姬或创作中心的推流码。服务器常见 `rtmp://live-push.bilivideo.com/live-bvc/` | 不使用非官方的弹幕 WebSocket |
| 视频号 | 视频号助手里发起直播后显示的推流地址 | 没有面向普通第三方的评论回调，用手动或你自己的合规转发 |
| TikTok | TikTok LIVE Studio 里的 Server URL 和 Stream key，账号需要有直播权限 | 评论事件只对获准的开发者开放 |

## 平台评论怎么进来

导播只消费已经进了灵播的评论。来源可以是预览间、模拟观众，或者平台回调。灵播不去抓直播间网页，也不去连各平台未公开的长连接。

回调地址是 `POST /api/ingest/<平台>`，平台取 `douyin`、`kuaishou`、`bilibili`、`wechat_channels`、`tiktok`、`custom`。必须配置 `INGEST_TOKEN`。令牌放在请求头 `X-Lingbo-Ingest-Token`，或 JSON 字段 `ingestToken`（读过就丢掉，不写进日志）。没配令牌时接口直接拒绝，避免变成开放中继。没有正在进行的场次时返回「直播还没开始」。

通用正文：

```json
{ "viewerName": "茶客", "text": "保质期多久", "externalId": "平台消息 id" }
```

`externalId` 相同的消息只进一次。抖音直播伴侣互动工具的 `OPEN_LIVE_DATA` 也可以直接转发，灵播只留下 `msg_type_str` 为 `live_comment` 的项（礼物和点赞丢掉）：

```json
{
  "payload": [
    { "msg_id": "735260", "msg_type": 2, "msg_type_str": "live_comment", "nickname": "茶客", "content": "保质期多久" }
  ]
}
```

各平台官方能做什么：

- **抖音**：申请开放平台「直播间数据」后，用 `live_comment` 任务把评论推到你的服务器（见开放平台「启动任务」文档），或在已审核的直播伴侣插件里收 `OPEN_LIVE_DATA`。你的服务器再转发到上面的地址。不要调用网页端未公开的 webcast 接口。
- **快手**：直播小玩法审核通过后才有弹幕推送。在那之前用通用 JSON，由你自己的合规服务转发。
- **哔哩哔哩**：互动玩法走哔哩哔哩开放平台。不接入流传的弹幕聊天室协议。
- **视频号**：普通商家没有公开的评论 Webhook。预览间手打，或等你拿到官方回调后再转发通用 JSON。
- **TikTok**：获准的 Live API 才有评论事件。同样转发通用 JSON，不要接非官方直播 WebSocket。

平台如果不能自定义请求头，用反向代理把令牌写进头，或把令牌放进 JSON 的 `ingestToken`。灵播目前不校验各平台自己的签名；签名校验放在你那一层转发里。

没配 LiveKit 时，`POST /api/sessions/:id/rtc` 返回 `provider: "local"`，预览间继续用内置主播。

## 接入话术模型和语音

`LLM_PROVIDER=openai` 且填了 `LLM_API_KEY` 时，口播和回答走 Chat Completions。模型要返回 JSON：

```json
{ "segments": [{ "kind": "opening", "text": "…" }] }
```

`kind` 可以是 `opening`、`selling_point`、`price`、`faq`、`closing`。调用失败就用本地话术，直播不会停。

`TTS_PROVIDER=http` 时，服务会 `POST` 到 `TTS_HTTP_URL`：

```json
{ "text": "家人们好", "voice": "小林", "rate": 1, "language": "zh-CN" }
```

响应需要：

```json
{ "audioUrl": "https://cdn.example.com/a.mp3", "durationMs": 2400 }
```

`audioUrl` 会在观众页播放；开了 LiveKit 时，导播台也会把它推进主播音轨。

`AVATAR_PROVIDER=video` 加上 `AVATAR_VIDEO_URL` 时，没有 LiveKit 画面的观众会看到这段循环视频。LiveKit 一旦有主播轨，以主播轨为准。

对应代码：

- `server/src/providers/llm.ts`
- `server/src/providers/tts.ts`
- `server/src/providers/avatar.ts`
- `server/src/providers/realtime.ts`
- `server/src/providers/output/`
- `server/src/providers/ingest.ts`
- `agent/src/worker.ts`

## 目录

```text
shared/        商品、场次、推流目的地、LiveKit 数据包
server/        API、导播循环、提供者、JSON 存储
web/           控制台、商品页、预览间、播出页
agent/         LiveKit Agents 主播 worker，单独安装
deploy/        本地 LiveKit 和 Egress 的配置
docker-compose.livekit.yml
docker-compose.rtmp.yml
```

导播循环在 `server/src/director.ts`：按商品生成话术，逐段播报，段与段之间回答一条未回复的评论。

## 测试

```bash
npm test
npm run typecheck
```

测试覆盖商品存储、本地话术和问答、模型或语音失败时的回退、开播后回答观众、LiveKit 令牌的推流权限、没配密钥时退回本地房间、串流密钥加密、FFmpeg 断线重连、Egress 的 RTMP 参数，以及抖音评论回调进房后被主播回答。

## 上线之前

这是单机可跑的商家工具，还没有登录。不要把 API 和评论回调直接暴露到公网。串流密钥在本机加密，换机器时带上 `OUTPUT_SECRET` 或 `output.key`。正式使用前至少还要补：账号与权限、评论审核、广告法范围内的承诺校验、真实库存和订单、把 JSON 换成数据库。数字人的嘴型和声音如果要对外播出，用 LiveKit Agent 加正式 TTS，再用 Egress 推到平台，而不是靠浏览器朗读。
