"""本机数字人 HTTP。

GET  /health
POST /v1/tts      正文是 wav
POST /v1/clip     JSON，videoUrl 只有 MuseTalk 真的写出 mp4 才有
POST /v1/publish  立刻返回，音频在后台推进 LiveKit
GET  /media/<file>
"""

from __future__ import annotations

import base64
import json
import os
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .publish import livekit_available, rewrite_host, start_publish
from .talk import TalkWorker
from .tts import resolve_engine, synthesize, wav_duration_ms

MAX_BODY = 24 * 1024 * 1024
_worker = TalkWorker()
_media = ""
_public = ""


def main() -> None:
    host = os.environ.get("LINGBO_HOST", "0.0.0.0")
    port = int(os.environ.get("LINGBO_PORT", "8790"))
    httpd = serve(host, port)
    bound = httpd.server_address[1]
    print(f"lingbo-avatar listening on http://{host}:{bound}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _worker.close()
        httpd.shutdown()


def serve(host: str = "127.0.0.1", port: int = 0) -> ThreadingHTTPServer:
    global _media, _public
    _media = os.environ.get("LINGBO_MEDIA_DIR") or tempfile.mkdtemp(prefix="lingbo-media-")
    os.makedirs(_media, exist_ok=True)
    _worker.start()
    httpd = ThreadingHTTPServer((host, port), Handler)
    bound = httpd.server_address[1]
    configured = os.environ.get("LINGBO_PUBLIC_URL", "").strip()
    _public = (configured or f"http://127.0.0.1:{bound}").rstrip("/")
    return httpd


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            talk = _worker.status()
            self._json(
                200,
                {
                    "ok": True,
                    "tts": resolve_engine(None),
                    "talkingHead": talk["engine"],
                    "cuda": talk["cuda"],
                    "talkError": talk["error"],
                    "livekit": livekit_available(),
                },
            )
            return
        if path.startswith("/media/"):
            name = os.path.basename(path)
            file_path = os.path.join(_media, name)
            if not os.path.isfile(file_path):
                self._json(404, {"error": "not_found"})
                return
            kind = "video/mp4" if name.endswith(".mp4") else "audio/wav"
            with open(file_path, "rb") as handle:
                data = handle.read()
            self._bytes(200, data, kind)
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self._read_json()
        except ValueError as error:
            self._json(400, {"error": str(error)})
            return
        if path == "/v1/tts":
            wav, duration, engine = synthesize(
                str(payload.get("text") or ""),
                str(payload.get("voice") or ""),
                str(payload.get("hostId") or ""),
                float(payload.get("rate") or 1),
                str(payload.get("engine") or "") or None,
            )
            self._bytes(200, wav, "audio/wav", {"X-Duration-Ms": str(duration), "X-Engine": engine})
            return
        if path == "/v1/clip":
            self._json(200, self._clip(payload))
            return
        if path == "/v1/publish":
            body = self._prepare_publish(payload)
            result = start_publish(body, _media)
            result.update(
                {
                    "durationMs": body.get("durationMs") or 0,
                    "engine": body.get("engine") or "portrait",
                    "audio": bool(body.get("audioPath")),
                    "video": bool(body.get("videoPath")) and body.get("engine") == "musetalk",
                }
            )
            self._json(200, result)
            return
        self._json(404, {"error": "not_found"})

    def _clip(self, payload: dict[str, Any]) -> dict[str, Any]:
        wav, duration, engine = self._audio_bytes(payload)
        audio_name = f"{uuid.uuid4().hex}.wav"
        audio_path = os.path.join(_media, audio_name)
        with open(audio_path, "wb") as handle:
            handle.write(wav)
        video_url = None
        talk = "portrait"
        portrait = _decode_file(payload.get("portraitBase64"), ".jpg")
        if portrait:
            timeout = float(os.environ.get("LINGBO_TALK_WAIT_MS", "8000") or "8000") / 1000
            out = os.path.join(_media, f"{uuid.uuid4().hex}.mp4")
            produced = _worker.render(portrait, audio_path, out, timeout)
            if produced:
                video_url = _public_url(os.path.basename(produced))
                talk = "musetalk"
        return {
            "audioUrl": _public_url(audio_name),
            "videoUrl": video_url,
            "durationMs": duration,
            "engine": talk,
            "tts": engine,
        }

    def _prepare_publish(self, payload: dict[str, Any]) -> dict[str, Any]:
        wav, duration, engine = self._audio_bytes(payload)
        audio_name = f"{uuid.uuid4().hex}.wav"
        audio_path = os.path.join(_media, audio_name)
        with open(audio_path, "wb") as handle:
            handle.write(wav)
        video_path = ""
        talk = "portrait"
        encoded_video = payload.get("videoBase64")
        if isinstance(encoded_video, str) and encoded_video and payload.get("videoEngine") == "musetalk":
            video_path = _decode_file(encoded_video, ".mp4") or ""
            if video_path:
                talk = "musetalk"
        return {
            "livekitUrl": rewrite_host(str(payload.get("livekitUrl") or "")),
            "token": str(payload.get("token") or ""),
            "audioPath": audio_path,
            "videoPath": video_path,
            "durationMs": duration,
            "engine": talk,
            "tts": engine,
        }

    def _audio_bytes(self, payload: dict[str, Any]) -> tuple[bytes, int, str]:
        encoded = payload.get("audioBase64")
        if isinstance(encoded, str) and encoded:
            raw = base64.b64decode(encoded)
            if raw[:4] == b"RIFF":
                return raw, wav_duration_ms(raw), "provided"
        return synthesize(
            str(payload.get("text") or ""),
            str(payload.get("voice") or ""),
            str(payload.get("hostId") or ""),
            float(payload.get("rate") or 1),
            str(payload.get("engine") or "") or None,
        )

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > MAX_BODY:
            raise ValueError("body_too_large")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("json_object_required")
        return data

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._bytes(status, body, "application/json; charset=utf-8")

    def _bytes(self, status: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)


def _public_url(name: str) -> str:
    return f"{_public}/media/{name}"


def _decode_file(encoded: Any, suffix: str) -> str | None:
    if not isinstance(encoded, str) or not encoded:
        return None
    try:
        raw = base64.b64decode(encoded)
    except Exception:
        return None
    name = f"{uuid.uuid4().hex}{suffix}"
    path = os.path.join(_media, name)
    with open(path, "wb") as handle:
        handle.write(raw)
    return path


if __name__ == "__main__":
    main()
