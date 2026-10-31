"""把一句口播的音频推进 LiveKit 房间。

有 MuseTalk 成片时再推视频帧。没有 livekit 包时立刻返回，不连房间。
容器里把 localhost / 127.0.0.1 改写成 host.docker.internal，才能看到宿主机上的 LiveKit。
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import urllib.parse
import wave
from typing import Any


def rewrite_host(url: str) -> str:
    if os.environ.get("LINGBO_IN_DOCKER", "") != "1" or not url:
        return url
    parts = urllib.parse.urlsplit(url)
    if parts.hostname not in ("localhost", "127.0.0.1"):
        return url
    auth = ""
    if parts.username:
        auth = parts.username
        if parts.password:
            auth += f":{parts.password}"
        auth += "@"
    port = f":{parts.port}" if parts.port else ""
    return urllib.parse.urlunsplit((parts.scheme, f"{auth}host.docker.internal{port}", parts.path, parts.query, parts.fragment))


def livekit_available() -> bool:
    try:
        import livekit.rtc  # noqa: F401
        return True
    except Exception:
        return False


def start_publish(payload: dict[str, Any], media_dir: str) -> dict[str, Any]:
    url = str(payload.get("livekitUrl") or "")
    token = str(payload.get("token") or "")
    if not url or not token:
        return {"published": False, "reason": "missing_token"}
    if not livekit_available():
        return {"published": False, "reason": "livekit_sdk_missing"}
    import threading

    threading.Thread(target=_run, args=(payload, media_dir), daemon=True).start()
    return {"published": True, "reason": "started"}


def _run(payload: dict[str, Any], media_dir: str) -> None:
    try:
        asyncio.run(_publish(payload, media_dir))
    except Exception as error:
        print(f"[lingbo-publish] {error}", flush=True)


async def _publish(payload: dict[str, Any], media_dir: str) -> None:
    del media_dir
    from livekit import rtc

    url = rewrite_host(str(payload.get("livekitUrl") or ""))
    token = str(payload.get("token") or "")
    audio_path = str(payload.get("audioPath") or "")
    video_path = str(payload.get("videoPath") or "")
    room = rtc.Room()
    await room.connect(url, token)
    try:
        if audio_path and os.path.isfile(audio_path):
            await _publish_audio(room, rtc, audio_path)
        if video_path and os.path.isfile(video_path) and payload.get("engine") == "musetalk":
            await _publish_video(room, rtc, video_path)
    finally:
        await room.disconnect()


async def _publish_audio(room: Any, rtc: Any, path: str) -> None:
    with wave.open(path, "rb") as handle:
        rate = handle.getframerate() or 16000
        channels = handle.getnchannels() or 1
        width = handle.getsampwidth() or 2
        raw = handle.readframes(handle.getnframes())
    if width != 2:
        return
    source = rtc.AudioSource(rate, channels)
    track = rtc.LocalAudioTrack.create_audio_track("lingbo-voice", source)
    options = rtc.TrackPublishOptions()
    options.source = rtc.TrackSource.SOURCE_MICROPHONE
    await room.local_participant.publish_track(track, options)
    samples = rate // 50
    step = samples * channels * 2
    for offset in range(0, len(raw), step):
        chunk = raw[offset : offset + step]
        if len(chunk) < step:
            chunk = chunk + b"\x00" * (step - len(chunk))
        frame = rtc.AudioFrame(chunk, rate, channels, samples)
        await source.capture_frame(frame)
    await source.wait_for_playout()


async def _publish_video(room: Any, rtc: Any, path: str) -> None:
    if not shutil.which("ffprobe") or not shutil.which("ffmpeg"):
        return
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0:s=x",
            path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    parts = (probe.stdout or "").strip().split("x")
    if len(parts) != 2:
        return
    width, height = int(parts[0]), int(parts[1])
    source = rtc.VideoSource(width, height)
    track = rtc.LocalVideoTrack.create_video_track("lingbo-camera", source)
    options = rtc.TrackPublishOptions()
    options.source = rtc.TrackSource.SOURCE_CAMERA
    await room.local_participant.publish_track(track, options)
    proc = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    assert proc.stdout is not None
    frame_bytes = width * height * 3
    while True:
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        frame = rtc.VideoFrame(width, height, rtc.VideoBufferType.RGB24, buf)
        source.capture_frame(frame)
        await asyncio.sleep(1 / 25)
    proc.wait(timeout=5)
