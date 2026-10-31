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
- 数字人：四位可选主播（小林、周衡、阿燃、陈姐），各有名字、声音、语气和肖像。本地用演播室背景、眨眼、待机动作，以及跟着口播走的口型。也可以上传一张正脸照片。HeyGem 和 MuseTalk 用来接真人短视频克隆（只驱动嘴部），LiveKit 远程形象和循环视频仍然可用。
- 预览间：看主播、商品卡和公屏。评论会进入队列，主播在下一小段之前回答。
- 平台推流：每个平台一条目的地（服务器地址 + 串流密钥）。开播后合成数字人画面和商品字幕，用 FFmpeg 或 LiveKit Egress 推 RTMP/RTMPS。控制台能看连接、推流中、重连和失败。
- 平台评论：只收你自己服务器上的回调，不抓平台的私有接口。
- 控制台：选轮播顺序、预览话术、开播和结束、看评论和简单统计。导播台可以暂停、插播一句、放下一句、换商品，并在自动和半自动之间切换。

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
| `TTS_PROVIDER` | `mock`、`http`、`cosyvoice`、`gpt-sovits` 或 `f5` |
| `TTS_HTTP_URL` / `TTS_API_KEY` | `http` 语音服务 |
| `CLONE_REF_AUDIO` / `CLONE_REF_TEXT` | 克隆音色的参考音频路径和对应文本。三个克隆引擎都要 |
| `COSYVOICE_URL` / `GPT_SOVITS_URL` / `F5_TTS_URL` | 对应引擎的地址。没配齐时退回本地时长 |
| `AVATAR_PROVIDER` | `local`、`http`、`livekit`、`video`、`heygem` 或 `musetalk` |
| `AVATAR_VIDEO_URL` | `video` 时的循环视频地址 |
| `AVATAR_HTTP_URL` / `AVATAR_API_KEY` | `http` 时每句口播换一段视频的地址和密钥 |
| `MUSETALK_URL` | `musetalk` 时的口型服务。请求里 `mouthOnly` 为 true，大约 8 秒没返回就改用本地肖像 |
| `HEYGEM_VIDEO_URL` / `HEYGEM_TTS_URL` | `heygem` 时本机成片服务和语音服务，默认 `8383` 和 `18180` |
| `HEYGEM_DATA_DIR` | 和 HeyGem 视频容器共用的成品目录。官方客户端在 Linux 上是 `~/duix_avatar_data/face2face/temp` |
| `HEYGEM_VIDEO_PATH` / `HEYGEM_HOST_VIDEOS` | 驱动视频在容器里的路径。后者按主播分开，如 `lin=lin.mp4,heng=heng.mp4` |
| `HEYGEM_REFERENCE_AUDIO` / `HEYGEM_REFERENCE_TEXT` | fish-speech 克隆音色用的参考音频和对应文本 |
| `HEYGEM_SCRIPT_WAIT_MS` / `HEYGEM_REPLY_WAIT_MS` | 口播和回复各等多久。默认都是 `0`：不等成片，先用本地肖像 |
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

没有 LiveKit 时，`REALTIME_PROVIDER=local`，预览间用本地肖像主播和 WebSocket。`OUTPUT_PROVIDER=mock` 时推流只记状态，不连外网。`OUTPUT_PROVIDER=ffmpeg` 时不需要 LiveKit，本机用 FFmpeg 把商品名、价格和当前口播画成 1280×720 再推 RTMP，断线会按 1 秒、2 秒、4 秒退避重连，最长 15 秒。

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

没配 LiveKit 时，`POST /api/sessions/:id/rtc` 返回 `provider: "local"`，预览间继续用本地肖像主播。

## 主播形象

控制台开播前选一位主播。选中后，名字、声音预设、语气和语速一起换上，补充要求不动。这一场开播后主播锁定，下一场再换。

| 主播 | 声音预设 | 语气 | 语速 | 画面 |
| --- | --- | --- | --- | --- |
| 小林 | `warm-female` | 热情讲解 | 自然 | 年轻女主播，珊瑚衬衫 |
| 周衡 | `calm-male` | 专业说明 | 舒缓 | 男主播，深色西装 |
| 阿燃 | `bright-female` | 热情讲解 | 轻快 | 马尾、锈红外套，节奏更快 |
| 陈姐 | `mature-female` | 温和介绍 | 舒缓 | 成熟女主播，米色毛衣 |

肖像和演播室背景在 `web/public/hosts/`。它们是为本仓库生成的原创合成图像，不是真人照片，也不对应任何公众人物，不来自图库。说明写在 `web/public/hosts/PROVENANCE.md`。可以随代码一起使用和修改。不要把这些脸说成某位真人。

本地渲染（`AVATAR_PROVIDER=local`，也是其它模式失败后的退路）：

- 上半身肖像叠在演播室背景上，左右做了渐隐。
- 待机时有轻微的左右晃动、呼吸和点头。说话时饱和度略高一点。
- 眨眼按时间周期盖一层肤色。
- 口型按这句话的时长把每个字映射成开合。标点把嘴合上。张开程度大约在 0.15 到 0.85。
- 如果这句口播带了 `audioUrl`，页面会播放它，并用音量再修正口型。
- 播出页 `/program/<场次>` 上有字幕和商品卡。LiveKit Egress 打开的就是这一页。控制台在 `LIVEKIT_HOST_PUBLISHER=browser` 时，推到房间里的画面也是同一套肖像和口型。

这还不是音素级唇形，也不是三维数字人。`TTS_PROVIDER=mock` 时没有音频字节，口型只跟着字的时间轴走。

### 什么是真的，什么仍是本地模拟

| 部分 | 现状 |
| --- | --- |
| 四位主播的肖像、名字、声音预设、语气 | 真的，开播就会写进这场的人设 |
| 演播室背景、眨眼、待机、按文本的口型、商品和字幕叠层 | 真的画面，跑在浏览器里 |
| 音量修正口型 | 只有这句口播真的有音频地址时才会用。模拟语音没有音频，所以不会走到这里 |
| `AVATAR_PROVIDER=http` | 真的 HTTP 调用。每句口播 `POST` 到 `AVATAR_HTTP_URL`。成功就播放返回的视频；失败则这句退回本地肖像，系统栏标成降级 |
| `AVATAR_PROVIDER=livekit` | 配置是真的：LiveKit 凭证齐全时，播出页和预览间优先播房间里的远程视频轨。Tavus、Hedra、Simli、bitHuman 或自建唇形模型要作为 Agents 插件或 Ingress 进这个房间，本仓库不打包这些 SDK |
| `AVATAR_PROVIDER=heygem` | 调用是真的，成片本身要另有一台带 NVIDIA 显卡的 HeyGem。口播会预先提交；默认不等结果。回复走本地肖像，除非这句成片已经好了。本机没有显卡和 Docker，这里没有实际跑过 HeyGem |
| `AVATAR_PROVIDER=video` | 真的循环播放 `AVATAR_VIDEO_URL`。没填地址则退回本地肖像 |
| 浏览器朗读 | 仍只在预览这台电脑上出声，不进 LiveKit 音轨，也不进推流 |
| FFmpeg 推流 | 仍是商品名、价格和口播字幕的合成画面，不含肖像。要把肖像主播推到平台，用 LiveKit Egress 打开播出页 |

`AVATAR_PROVIDER=http` 的请求体：

```json
{ "text": "家人们好", "voice": "warm-female", "hostId": "lin", "language": "zh-CN" }
```

有 `AVATAR_API_KEY` 时带 `Authorization: Bearer`。响应需要：

```json
{ "videoUrl": "https://cdn.example.com/line.mp4" }
```

`videoUrl` 必须是 http 或 https。导播把这个地址放进这场的 `speech` 事件，播出页和预览间播这一句，播完回到肖像。

`AVATAR_PROVIDER=livekit` 且 `REALTIME_PROVIDER=livekit`、三项 LiveKit 凭证都在时，系统信息里的形象是 `livekit`。Agent 调度的 metadata 里带 `hostId`、`voice` 和 `avatar`。`agent/src/worker.ts` 里换成 [LiveKit Agents 的形象插件](https://github.com/livekit/agents)（Tavus、Hedra、Simli、bitHuman 等），或让供应商把 RTMP 送进 Ingress（参与者 `avatar-source`）。房间里一有视频轨，播出页就用它，不再画本地肖像。凭证不全时自动退回本地肖像，并标成降级。

## HeyGem 适不适合接进来

看过的是 [duixcom/Duix.Heygem](https://github.com/duixcom/Duix.Heygem) 主分支（仓库里的英文名是 Duix.Avatar，发布方是 Duix / DUIX.COM，也就是硅基智能这一套）。结论：可以当作**离线口播成片**用，不适合当作直播间的实时嘴。已经按这个结论接上，默认不启用。

### 它实际是什么

仓库里的开源部分是 Electron 客户端和它调用的 HTTP 约定。唇形和声音跑在三只 Docker 镜像里，不在 git 里：

| 服务 | 镜像 | 本机端口 | 作用 |
| --- | --- | --- | --- |
| 声音 | `guiji2025/fish-speech-ziming` | `18180` | 用一段参考音频克隆音色，`POST /v1/invoke`。`streaming` 在官方客户端里写死为 `false`，返回的是整段 wav |
| 识别 | `guiji2025/fun-asr` | `10095` | 训练音色时把参考音频转成文本。直播这一步用不上 |
| 口型成片 | `guiji2025/duix.avatar`（旧 compose 里叫 `guiji2025/heygem.ai`） | `8383` | `POST /easy/submit` 提交，`GET /easy/query?code=` 轮询。`data.status` 为 `2` 才算完成，成品是数据目录里的 mp4 路径，不是一条公网视频地址 |

官方 README 第 7 节写的是：这个项目做数字人克隆和**非实时**视频合成；要实时交互，去他们的网站 duix.com。社区里一次大约 48 秒成片的任务日志耗时 233 秒。短句会快一些，但仍然是「提交然后等文件」，不是一帧一帧推给直播。

中文：训练接口的 `lang` 可以是 `zh`，语音是 fish-speech，识别是 FunASR，文案语言列表里有中文。官方对比表把开源这路口形写成「效果可用」，把他们的商业接口写成「效果惊艳且更高清」。这里没有显卡，也没有把镜像拉下来，所以没有自己的样片可以对照这句话。

硬件以他们的 Ubuntu 22.04 说明为准：必须有 NVIDIA 显卡和驱动，推荐 RTX 4070、内存 32GB、磁盘空闲 100GB 以上。三只镜像大约 70GB。没有显卡时服务起不来。Windows 走 WSL 加 Docker。本开发环境 `nvidia-smi` 和 `docker` 都没有，所以这条路径只做了契约测试，没有真的合成过一张脸。

驱动素材必须是你自己有权使用的短视频和参考音频（官方流程是大约 10 秒的视频）。仓库里的四张肖像是静止合成图，**不能**拿去当 HeyGem 的克隆底片。

### 授权，两处说法不一致

2026-10-31 读到的 [LICENSE](https://github.com/duixcom/Duix.Heygem/blob/main/LICENSE) 是 DUIX.COM Community License，不是 MIT，也不是 Apache。要点：

- 可以在条款内使用、复制、修改、再分发。
- 再分发或做成服务时，要随附协议、在界面或文档上显著标明 **Built with DUIX.COM**，并在用户协议里说明用了 DUIX.COM 的技术。
- 额外商业条款：产品或服务的月活超过 1000，就要另行向 DUIX.COM 申请商业许可，对方可以不批。没批之前不能行使协议里的权利。
- 输出按「原样」提供，对方不承担适配直播的保证。

同一份 README 的对比表仍写着「全球免费商用，用户量超过 10 万或年营收超过 1000 万美元才要商业协议」。这和 LICENSE 里的 1000 月活不是同一个门槛。以 LICENSE 文件为准；要用在对外售卖的直播里，先让法务看过这份协议，不要只看那张表。

灵播没有把他们的代码或镜像打进仓库。`AVATAR_PROVIDER=heygem` 且配齐之后，页脚会显示 `Built with DUIX.COM`。这只覆盖标识，不代替你自己的合规判断。

### 直播上怎么用

HeyGem 做不了「评论一来，嘴立刻跟上」。接法是：

1. 一场口播生成后，立刻把每一句提交给 HeyGem，不挡住开播。
2. 说到这句时，成片已经在 `HEYGEM_DATA_DIR` 里，就复制到 `/uploads/`，播出页和预览间播这句视频。
3. 成片还没好，或者这句是观众回复：马上用本地肖像。`HEYGEM_REPLY_WAIT_MS` 默认是 0。
4. 商品转到下一轮，同一句如果已经合成完，就改播视频。想让第一轮也等，把 `HEYGEM_SCRIPT_WAIT_MS` 调大，直播会在这一句上停住。

配不齐数据目录、驱动视频或参考音频时，形象标成降级，全程用本地肖像，不会去连 8383 端口。

### MuseTalk 和 LiveTalking

- [MuseTalk](https://github.com/TMElyralab/MuseTalk)（腾讯音乐 Lyra）：代码 MIT，作者写明模型权重可以商用，附带的其它模型另有许可证，仓库里的测试数据不能商用。它宣称在 V100 上可以超过 30 帧，脸部区域 256，支持中文音频。限制是身份细节会丢、单帧生成会抖。官方仓库没有一个固定的 HTTP 守护进程。`AVATAR_PROVIDER=musetalk` 时，灵播会 `POST` 到 `MUSETALK_URL`：

```json
{ "text": "家人们好", "audioUrl": "/uploads/tts-1.wav", "portraitUrl": "/uploads/me.jpg", "mouthOnly": true, "hostId": "lin", "language": "zh-CN" }
```

响应要是 `{ "videoUrl": "http://..." }`。大约 8 秒没有可用地址就改播本地肖像。你需要自己用 MuseTalk 包这一层。本机没有 NVIDIA，没有跑过这个模型。

- [LiveTalking](https://github.com/lipku/LiveTalking)：Apache-2.0，定位就是实时流式数字人，能用 wav2lip、MuseTalk 等模型，输出 WebRTC 和 RTMP。LiveKit 输出在他们的商用版里，不在开源版。它是另一套要单独部署的流媒体服务，这里没有接进去。

所以：有显卡、有权使用的真人短视频、可以接受口播先出、回复用本地肖像，再用 HeyGem。要评论和嘴尽量对齐，在 GPU 机器上把 MuseTalk 包成上面的 HTTP，或把视频轨推进 LiveKit 房间。不配任何外部服务时，仍然是这四位肖像加文本口型。

## 接入话术模型和语音

`LLM_PROVIDER=openai` 且填了 `LLM_API_KEY` 时，口播和回答走 Chat Completions。模型要返回 JSON：

```json
{ "segments": [{ "kind": "opening", "text": "…" }] }
```

`kind` 可以是 `opening`、`selling_point`、`price`、`faq`、`closing`。调用失败就用本地话术，直播不会停。

`TTS_PROVIDER=http` 时，服务会 `POST` 到 `TTS_HTTP_URL`：

```json
{ "text": "家人们好", "voice": "warm-female", "name": "小林", "hostId": "lin", "rate": 1, "language": "zh-CN" }
```

响应需要：

```json
{ "audioUrl": "https://cdn.example.com/a.mp3", "durationMs": 2400 }
```

`audioUrl` 会在观众页播放；开了 LiveKit 时，导播台也会把它推进主播音轨。

克隆音色三个都要 `CLONE_REF_AUDIO`（本机文件）和 `CLONE_REF_TEXT`（这段音频里说的字）。缺任何一个，系统信息里的语音会标成降级，口播只用本地时长。

- `cosyvoice`：`POST {COSYVOICE_URL}/inference_zero_shot`，表单字段 `tts_text`、`prompt_text`、`prompt_wav`。这是 CosyVoice 官方 FastAPI 的零样本接口，响应是 wav 字节。
- `gpt-sovits`：`POST {GPT_SOVITS_URL}/tts`（地址已经以 `/tts` 结尾就不再加）。JSON 含 `text`、`text_lang=zh`、`ref_audio_path`、`prompt_text`、`prompt_lang=zh`、`media_type=wav`、`streaming_mode=false`、`speed_factor`。响应是 wav 字节。
- `f5`：F5-TTS 没有稳定的官方 REST。这里约定一个小桥，`POST {F5_TTS_URL}`，JSON 是 `{ "gen_text", "ref_audio", "ref_text", "speed" }`。响应可以是 wav 字节，或 `{ "audioUrl": "..." }`。

wav 会存到 `/uploads/tts-<id>.wav`。这三个服务都要你自己部署。本仓库的测试只核对请求形状，没有连真实模型。

形象接法见上一节和下面的曜灵对照。LiveKit 房间里一旦有主播视频轨，播出页以这路轨为准。

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
web/           控制台、商品页、预览间、播出页、主播肖像
agent/         LiveKit Agents 主播 worker，单独安装
deploy/        本地 LiveKit 和 Egress 的配置
docker-compose.livekit.yml
docker-compose.rtmp.yml
```

导播循环在 `server/src/director.ts`：按商品生成话术，逐段播报，段与段之间回答一条未回复的评论。暂停时不再开口；半自动从第二句起要等「下一句」；插播排在下一句口播之前；关掉循环后，当前商品讲完就结束。

## 对照曜灵（Xiling）

产品目标是接近百度智能云曜灵的数字人直播间，并用开源组件把持续费用降到零：模型、LiveKit 和推流都跑在你自己的机器上。下面这张表按一份公开资料检索摘要来对照。那份摘要来自搜索片段，细节没有逐条在官方页面核对，所以这里只把它当能力清单，不把它里的价格、后台和合规条文写成已核实事实。

| 曜灵能力 | 灵播现在 | 需要你的 GPU 机器验证 | 还没做 |
| --- | --- | --- | --- |
| 真人短视频克隆，主要驱动嘴部 | `AVATAR_PROVIDER=heygem` 预生成口播成片；`AVATAR_PROVIDER=musetalk` 按句请求，`mouthOnly: true` | HeyGem 的 Docker 和 MuseTalk 服务都要 NVIDIA。本环境没有显卡，也没有跑过这两个模型 | 仓库内不包含模型权重，也没有把 MuseTalk 包成进程 |
| 一张照片驱动形象 | 导播台上传一张正脸，播出页用这张图，眨眼和嘴仍按所选主播的脸部位置估算 | 不需要 GPU | 不是照片重建的三维头，也不是只动嘴的像素级克隆 |
| 克隆音色 | `TTS_PROVIDER` 可选 `cosyvoice`、`gpt-sovits`、`f5`，都吃一段参考音频和对应文本 | 三个引擎都要你自己起服务。这里只核对了请求，没有听过合成结果 | 没有在浏览器里训练音色 |
| 推流到抖音等平台 | 多目的地 RTMP/RTMPS，密钥加密，FFmpeg 或 LiveKit Egress。预览间只是试看 | 用你的推流地址才能确认平台侧收得到 | 没有代开播、没有平台登录 |
| 按商品自动写口播 | 已有。默认本地模板，也可接兼容 OpenAI 的模型 | 模型质量取决于你填的接口 | 没有商品知识的向量库 |
| 弹幕问答，不必先配问答库 | 已有。本地回答用标题、价格、卖点和发货口径；问答对上了才用问答。接模型时，提示词写明问答列表可以为空，并带上商品介绍 | 模型回答要你自己看是否编造 | 没有单独的检索服务 |
| 预生成讲解，实时插入回答 | HeyGem 在口播生成后预先提交成片；观众回答默认不等成片，先用本地肖像。MuseTalk 在大约 8 秒内返回视频就插进这一句 | 成片速度和嘴型要在 GPU 上看 | 回答没有单独的实时嘴型模型跑在本进程里 |
| 导播台人工接管 | 已有：暂停、继续、插播一句、下一句、换下一个商品、自动 / 半自动 | 不需要 GPU。开播后在控制台「导播台」就能试 | 没有单独的硬件导播台 |
| 7×24 轮播 | `loop` 默认开，商品名单讲完再从头 | 长时间运行要你自己盯进程 | 没有进程守护和断线告警服务 |
| AI 数字人标识 | 默认打开。播出页、预览间和导播画面上有「AI数字人直播」，可以关掉 | 平台是否认这个字样，要看各平台当时的规则 | 没有按平台自动切换不同标识文案 |
| 直播间装修 | 演播室背景、商品卡、价格和字幕。可换成一块纯绿底 | 绿底能不能被平台抠干净，要看推流画面 | 没有模板市场。绿幕是纯色背景，不是人像抠图 |
| 语义动作、3D 写实、2D 精品资产库 | 四位合成肖像加待机和眨眼 |  | 这些都还没有。肖像不是真人，也不是明星 |
| 数据看板、官方合规细则 | 控制台有评论数、回复数、口播时长 |  | 检索摘要里没在官方页核实到的后台和规则，这里不编 |

开播前请打开 AI 标识。不要把循环打开后就离开：没有人接管、也不回答评论的纯循环，可能被平台当成录播。评论回复保持可用，半自动时用「下一句」往下走。

## 测试

```bash
npm test
npm run typecheck
```

测试覆盖商品存储、主播人设的保存和未知形象回退、口型时间轴、HTTP 形象和 MuseTalk 的请求与失败回退、克隆音色的请求形状、开播后把口播视频地址带上、暂停时插播不先说、关掉循环后本轮商品讲完就结束、本地话术和问答、模型或语音失败时的回退、开播后回答观众、LiveKit 令牌的推流权限、没配密钥时退回本地房间、串流密钥加密、FFmpeg 断线重连、Egress 的 RTMP 参数，以及抖音评论回调进房后被主播回答。

## 上线之前

这是单机可跑的商家工具，还没有登录。不要把 API 和评论回调直接暴露到公网。串流密钥在本机加密，换机器时带上 `OUTPUT_SECRET` 或 `output.key`。正式使用前至少还要补：账号与权限、评论审核、广告法范围内的承诺校验、真实库存和订单、把 JSON 换成数据库。本地口型是按字和音量估算的。要对平台播出更接近真人的嘴型，用 `AVATAR_PROVIDER=http` 接一段一段的口播视频，用 `AVATAR_PROVIDER=heygem` 在有显卡的机器上预生成口播成片，用 `AVATAR_PROVIDER=musetalk` 接只动嘴的口型服务，或用 `AVATAR_PROVIDER=livekit` 接 Agents 形象插件。音色用 `cosyvoice`、`gpt-sovits` 或 `f5`，再由 Egress 推到平台。HeyGem 不是实时嘴，回复默认仍走本地肖像。浏览器朗读仍然进不了推流。播出页默认带「AI数字人直播」。不要无人值守地开着纯循环。
