#!/usr/bin/env python3
"""准备本机数字人要用的模型。

默认什么都不下载，只打印步骤。权重要在有 NVIDIA 显卡的机器上下。

  python3 download_models.py --musetalk
      把 MuseTalk 克隆到 models/MuseTalk，并固定到已核对过参数的提交。
      不下载权重。

  python3 download_models.py --weights
      在已经克隆的目录里执行上游 download_weights.sh。体积大约几十 GB，
      还会访问 Hugging Face 和 Google Drive。

  python3 download_models.py --piper
      下载 Piper 的中文音色 zh_CN-huayan-medium（约 63MB）。
      还需要自行安装 piper 可执行文件。见 README 的许可证说明。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
MUSETALK_PIN = "0a89dec45a0192b824e3cf4daf96c239440c5ed8"
MUSETALK_DIR = os.path.join(ROOT, "models", "MuseTalk")
PIPER_DIR = os.path.join(ROOT, "models", "piper")
PIPER_ONNX = "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx"
PIPER_JSON = "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json"


def main() -> int:
    parser = argparse.ArgumentParser(description="下载灵播本机数字人的可选模型")
    parser.add_argument("--musetalk", action="store_true", help="克隆 MuseTalk 到固定提交，不下载权重")
    parser.add_argument("--weights", action="store_true", help="执行上游 download_weights.sh")
    parser.add_argument("--piper", action="store_true", help="下载 zh_CN-huayan-medium")
    args = parser.parse_args()
    if not (args.musetalk or args.weights or args.piper):
        print("没有选择下载项。可用 --musetalk、--weights、--piper。")
        print(f"MuseTalk 固定提交：{MUSETALK_PIN}")
        print("显存：fp16 加载大约 4GB，建议 8GB 才能装下，12GB 以上再同时编码和推流。")
        print("本脚本不会在无参数时访问网络。")
        return 0
    if args.musetalk:
        clone_musetalk()
    if args.weights:
        script = os.path.join(MUSETALK_DIR, "download_weights.sh")
        if not os.path.isfile(script):
            print("还没有克隆。先运行 python3 download_models.py --musetalk", file=sys.stderr)
            return 1
        subprocess.check_call(["bash", script], cwd=MUSETALK_DIR)
    if args.piper:
        os.makedirs(PIPER_DIR, exist_ok=True)
        fetch(PIPER_ONNX, os.path.join(PIPER_DIR, "zh_CN-huayan-medium.onnx"))
        fetch(PIPER_JSON, os.path.join(PIPER_DIR, "zh_CN-huayan-medium.onnx.json"))
        print("PIPER_MODEL=" + os.path.join(PIPER_DIR, "zh_CN-huayan-medium.onnx"))
    return 0


def clone_musetalk() -> None:
    os.makedirs(os.path.dirname(MUSETALK_DIR), exist_ok=True)
    if not os.path.isdir(os.path.join(MUSETALK_DIR, ".git")):
        subprocess.check_call(["git", "clone", "https://github.com/TMElyralab/MuseTalk.git", MUSETALK_DIR])
    subprocess.check_call(["git", "fetch", "--depth", "1", "origin", MUSETALK_PIN], cwd=MUSETALK_DIR)
    subprocess.check_call(["git", "checkout", MUSETALK_PIN], cwd=MUSETALK_DIR)
    print(f"MuseTalk 已在 {MUSETALK_DIR} @ {MUSETALK_PIN}")
    print("下一步（只在 GPU 机器上）：python3 download_models.py --weights")
    print("然后：export MUSETALK_ROOT=" + MUSETALK_DIR)


def fetch(url: str, dest: str) -> None:
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        print(f"已有 {dest}")
        return
    print(f"下载 {url}")
    urllib.request.urlretrieve(url, dest)


if __name__ == "__main__":
    raise SystemExit(main())
