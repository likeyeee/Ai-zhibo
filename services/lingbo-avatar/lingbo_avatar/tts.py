"""中文语音。

默认走 edge-tts（单独进程里调用，不放进 Node 仓库）。
没有这个包、或微软接口失败时，再用 Piper 命令行。
两者都不可用时，返回一段与字数相称的静音 wav，接口仍然成立。
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import wave

EDGE_VOICES = {
    "lin": "zh-CN-XiaoxiaoNeural",
    "warm-female": "zh-CN-XiaoxiaoNeural",
    "heng": "zh-CN-YunxiNeural",
    "calm-male": "zh-CN-YunxiNeural",
    "ran": "zh-CN-XiaoyiNeural",
    "bright-female": "zh-CN-XiaoyiNeural",
    "chen": "zh-CN-XiaomoNeural",
    "mature-female": "zh-CN-XiaomoNeural",
}


def estimate_ms(text: str, rate: float) -> int:
    chars = max(1, len(text or ""))
    speed = min(1.6, max(0.6, rate or 1.0))
    return int(min(7000, max(800, (chars * 150) / speed)))


def rate_string(rate: float) -> str:
    pct = round((float(rate or 1) - 1) * 100)
    return f"{pct:+d}%"


def edge_voice(voice: str, host_id: str) -> str:
    return EDGE_VOICES.get(host_id) or EDGE_VOICES.get(voice) or "zh-CN-XiaoxiaoNeural"


def silent_wav(duration_ms: int, sample_rate: int = 16000) -> bytes:
    frames = max(1, int(sample_rate * duration_ms / 1000))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def wav_duration_ms(data: bytes) -> int:
    with wave.open(io.BytesIO(data), "rb") as handle:
        rate = handle.getframerate() or 1
        return int(handle.getnframes() * 1000 / rate)


def importable(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:
        return False


def piper_model() -> str:
    return os.environ.get("PIPER_MODEL", "").strip()


def piper_ready() -> bool:
    return bool(shutil.which("piper") and piper_model() and os.path.isfile(piper_model()))


def resolve_engine(requested: str | None = None) -> str:
    choice = (requested or os.environ.get("LINGBO_TTS", "auto") or "auto").strip().lower()
    if choice == "silent":
        return "silent"
    if choice == "piper":
        return "piper" if piper_ready() else "silent"
    if choice == "edge":
        return "edge" if importable("edge_tts") else "silent"
    if importable("edge_tts"):
        return "edge"
    if piper_ready():
        return "piper"
    return "silent"


def to_wav(raw: bytes) -> bytes | None:
    if raw[:4] == b"RIFF":
        return raw
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    proc = subprocess.run(
        [
            ffmpeg,
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-f",
            "wav",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "pipe:1",
        ],
        input=raw,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0 or proc.stdout[:4] != b"RIFF":
        return None
    return proc.stdout


def synthesize(text: str, voice: str, host_id: str, rate: float, engine: str | None = None) -> tuple[bytes, int, str]:
    choice = resolve_engine(engine)
    spoken = (text or "").strip() or " "
    if choice == "edge":
        audio = _edge(spoken, edge_voice(voice, host_id), rate)
        if audio:
            wav = to_wav(audio)
            if wav:
                return wav, wav_duration_ms(wav), "edge"
        choice = "piper" if piper_ready() else "silent"
    if choice == "piper":
        wav = _piper(spoken)
        if wav:
            return wav, wav_duration_ms(wav), "piper"
    duration = estimate_ms(spoken, rate)
    return silent_wav(duration), duration, "silent"


def _edge(text: str, voice: str, rate: float) -> bytes | None:
    try:
        import asyncio

        import edge_tts
    except Exception:
        return None

    async def run() -> bytes:
        communicate = edge_tts.Communicate(text, voice, rate=rate_string(rate))
        chunks: list[bytes] = []
        async for piece in communicate.stream():
            if piece.get("type") == "audio" and piece.get("data"):
                chunks.append(piece["data"])
        return b"".join(chunks)

    try:
        data = asyncio.run(run())
    except Exception:
        return None
    return data or None


def _piper(text: str) -> bytes | None:
    model = piper_model()
    binary = shutil.which("piper")
    if not binary or not model:
        return None
    try:
        proc = subprocess.run(
            [binary, "--model", model, "--output_file", "-"],
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=60,
            check=False,
        )
    except Exception:
        return None
    if proc.returncode != 0 or proc.stdout[:4] != b"RIFF":
        return None
    return proc.stdout
