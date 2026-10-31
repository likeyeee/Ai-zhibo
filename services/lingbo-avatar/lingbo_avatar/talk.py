"""MuseTalk 口型。

权重和代码留在 MUSETALK_ROOT，由常驻子进程加载一次。
本文件只负责判断能不能启动，以及在超时内取回 mp4。
没有权重、没有显卡、或这一句来不及时，video 保持为空，页面继续用二维口型。
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from typing import Any


def _torch_cuda() -> bool:
    try:
        import torch
    except Exception:
        return False
    try:
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def musetalk_root() -> str:
    return os.environ.get("MUSETALK_ROOT", "").strip()


def weights_ready(root: str | None = None) -> bool:
    base = root if root is not None else musetalk_root()
    if not base:
        return False
    script = os.path.join(base, "scripts", "inference.py")
    weights = os.path.join(base, "models", "musetalkV15", "unet.pth")
    config = os.path.join(base, "models", "musetalkV15", "musetalk.json")
    return os.path.isfile(script) and os.path.isfile(weights) and os.path.isfile(config)


def musetalk_argv(root: str, config_yaml: str, result_dir: str) -> list[str]:
    """与 inference.sh v1.5 对齐的参数。常驻进程走同一套权重路径。"""
    return [
        sys.executable,
        "-m",
        "scripts.inference",
        "--version",
        "v15",
        "--use_float16",
        "--unet_model_path",
        os.path.join(root, "models", "musetalkV15", "unet.pth"),
        "--unet_config",
        os.path.join(root, "models", "musetalkV15", "musetalk.json"),
        "--whisper_dir",
        os.path.join(root, "models", "whisper"),
        "--inference_config",
        config_yaml,
        "--result_dir",
        result_dir,
        "--extra_margin",
        "10",
        "--fps",
        "25",
        "--batch_size",
        os.environ.get("LINGBO_MUSETALK_BATCH", "8"),
        "--parsing_mode",
        "jaw",
        "--use_saved_coord",
        "--saved_coord",
    ]


class TalkWorker:
    def __init__(self) -> None:
        self.engine = "portrait"
        self.cuda = False
        self.error = ""
        self._proc: subprocess.Popen[str] | None = None
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self._ready = threading.Event()
        self._busy = False
        self._lock = threading.Lock()
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        mode = os.environ.get("LINGBO_TALKING_HEAD", "auto").strip().lower()
        root = musetalk_root()
        if mode == "portrait" or not root or not os.path.isfile(os.path.join(root, "scripts", "inference.py")):
            self.engine = "portrait"
            self.cuda = _torch_cuda()
            self._ready.set()
            return
        service_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        env = os.environ.copy()
        env["PYTHONPATH"] = service_root + os.pathsep + env.get("PYTHONPATH", "")
        env["MUSETALK_ROOT"] = root
        self._proc = subprocess.Popen(
            [sys.executable, "-m", "lingbo_avatar.warm"],
            cwd=service_root,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        self._ready.wait(timeout=5)
        if not self._ready.is_set():
            self.engine = "loading"

    def status(self) -> dict[str, Any]:
        return {"engine": self.engine, "cuda": self.cuda, "error": self.error}

    def render(self, portrait: str, audio: str, output: str, timeout: float) -> str | None:
        if self.engine != "musetalk" or self._proc is None or self._proc.poll() is not None:
            return None
        if self._busy:
            return None
        if timeout <= 0:
            return None
        payload = {"portrait": portrait, "audio": audio, "output": output, "fps": 25}
        with self._lock:
            if self._busy or self._proc.stdin is None:
                return None
            self._busy = True
            self._proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            self._proc.stdin.flush()
        try:
            message = self._queue.get(timeout=timeout)
        except queue.Empty:
            return None
        if message.get("ok") and isinstance(message.get("video"), str) and os.path.isfile(message["video"]):
            return message["video"]
        return None

    def _read_stdout(self) -> None:
        assert self._proc is not None and self._proc.stdout is not None
        for line in self._proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "ready" in message and not self._ready.is_set():
                self.cuda = bool(message.get("cuda"))
                self.error = str(message.get("error") or "")
                self.engine = "musetalk" if message.get("ready") else "portrait"
                self._ready.set()
                continue
            self._busy = False
            self._queue.put(message)
        self._busy = False
        if not self._ready.is_set():
            self.engine = "portrait"
            self.error = self.error or "worker_exited"
            self._ready.set()

    def _drain_stderr(self) -> None:
        assert self._proc is not None and self._proc.stderr is not None
        for line in self._proc.stderr:
            text = line.rstrip()
            if text:
                print(f"[musetalk] {text}", file=sys.stderr, flush=True)

    def close(self) -> None:
        proc = self._proc
        if proc is None or proc.poll() is not None:
            return
        proc.terminate()
