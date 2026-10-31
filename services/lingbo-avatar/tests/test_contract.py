"""不连微软、不加载 MuseTalk、不需要显卡。"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

os.environ["LINGBO_TTS"] = "silent"
os.environ["LINGBO_TALKING_HEAD"] = "portrait"
os.environ["LINGBO_MEDIA_DIR"] = tempfile.mkdtemp(prefix="lingbo-contract-")
os.environ.pop("LINGBO_PUBLIC_URL", None)
os.environ["LINGBO_IN_DOCKER"] = "0"

from lingbo_avatar.publish import rewrite_host  # noqa: E402
from lingbo_avatar.server import serve  # noqa: E402
from lingbo_avatar.talk import musetalk_argv  # noqa: E402
from lingbo_avatar.tts import estimate_ms, rate_string, silent_wav  # noqa: E402


class ContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.httpd = serve("127.0.0.1", 0)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def test_health(self) -> None:
        with urllib.request.urlopen(self.url("/health"), timeout=5) as response:
            body = json.loads(response.read().decode())
        self.assertTrue(body["ok"])
        self.assertEqual(body["tts"], "silent")
        self.assertEqual(body["talkingHead"], "portrait")
        self.assertFalse(body["cuda"])

    def test_tts_is_wav(self) -> None:
        request = urllib.request.Request(
            self.url("/v1/tts"),
            data=json.dumps({"text": "家人们，这款红茶现在一百二十八", "voice": "warm-female", "hostId": "lin", "rate": 1}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            data = response.read()
            self.assertEqual(response.headers["X-Engine"], "silent")
            duration = int(response.headers["X-Duration-Ms"])
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertGreater(duration, 700)
        self.assertLess(duration, 8000)

    def test_clip_has_audio_and_no_fake_video(self) -> None:
        request = urllib.request.Request(
            self.url("/v1/clip"),
            data=json.dumps({"text": "口感顺", "voice": "calm-male", "hostId": "heng", "rate": 0.85, "portraitBase64": ""}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            body = json.loads(response.read().decode())
        self.assertIsNone(body["videoUrl"])
        self.assertEqual(body["engine"], "portrait")
        self.assertEqual(body["tts"], "silent")
        with urllib.request.urlopen(body["audioUrl"], timeout=5) as audio:
            self.assertTrue(audio.read().startswith(b"RIFF"))

    def test_publish_without_livekit_sdk(self) -> None:
        request = urllib.request.Request(
            self.url("/v1/publish"),
            data=json.dumps(
                {
                    "livekitUrl": "ws://127.0.0.1:9",
                    "token": "test-token",
                    "text": "试播一句",
                    "hostId": "lin",
                    "voice": "warm-female",
                    "rate": 1,
                }
            ).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            body = json.loads(response.read().decode())
        self.assertFalse(body["published"])
        self.assertEqual(body["reason"], "livekit_sdk_missing")
        self.assertTrue(body["audio"])
        self.assertFalse(body["video"])

    def test_musetalk_flags_match_upstream_v15(self) -> None:
        argv = musetalk_argv("/models/MuseTalk", "/tmp/job.yaml", "/tmp/results")
        self.assertIn("v15", argv)
        self.assertIn("--use_float16", argv)
        self.assertIn("/models/MuseTalk/models/musetalkV15/unet.pth", argv)
        self.assertNotIn("--skip_save_images", argv)

    def test_docker_rewrites_localhost(self) -> None:
        os.environ["LINGBO_IN_DOCKER"] = "1"
        try:
            self.assertEqual(rewrite_host("ws://127.0.0.1:7880"), "ws://host.docker.internal:7880")
            self.assertEqual(
                rewrite_host("http://localhost:5173/program/abc"),
                "http://host.docker.internal:5173/program/abc",
            )
        finally:
            os.environ["LINGBO_IN_DOCKER"] = "0"
        self.assertEqual(rewrite_host("ws://127.0.0.1:7880"), "ws://127.0.0.1:7880")

    def test_silent_wav_and_rate(self) -> None:
        self.assertEqual(rate_string(1), "+0%")
        self.assertEqual(rate_string(1.2), "+20%")
        self.assertEqual(rate_string(0.85), "-15%")
        self.assertEqual(estimate_ms("家人们好", 1), 800)
        self.assertTrue(silent_wav(800).startswith(b"RIFF"))


if __name__ == "__main__":
    unittest.main()
