"""常驻 MuseTalk 1.5 进程。

对照上游 commit 0a89dec45a0192b824e3cf4daf96c239440c5ed8 的
scripts/inference.py：同一套 v1.5 权重、float16、jaw 融合、25fps。
模型只加载一次。肖像的关键点和潜变量按文件内容缓存，下一句同一张脸不必再检脸。

stdout 只写 JSON。上游的 print 转到 stderr，避免把协议行弄乱。
本进程在没有显卡的环境里不会被启动；这里的加载路径没有在无 GPU 的云主机上跑通过。
"""

from __future__ import annotations

import hashlib
import json
import os
import pickle
import subprocess
import sys
from typing import Any


def _emit(obj: dict[str, Any]) -> None:
    sys.__stdout__.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()


def _redirect_prints() -> None:
    class _Stderr:
        def write(self, data: str) -> int:
            return sys.__stderr__.write(data)

        def flush(self) -> None:
            sys.__stderr__.flush()

    sys.stdout = _Stderr()


def main() -> None:
    _redirect_prints()
    root = os.environ.get("MUSETALK_ROOT", "").strip()
    if not root or not os.path.isdir(root):
        _emit({"ready": False, "cuda": False, "error": "musetalk_root_missing"})
        return
    os.chdir(root)
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        import cv2
        import numpy as np
        import torch
        from musetalk.utils.audio_processor import AudioProcessor
        from musetalk.utils.blending import get_image
        from musetalk.utils.face_parsing import FaceParsing
        from musetalk.utils.preprocessing import coord_placeholder, get_landmark_and_bbox
        from musetalk.utils.utils import datagen, load_all_model
        from transformers import WhisperModel
    except Exception as error:
        _emit({"ready": False, "cuda": False, "error": f"import_failed: {error}"})
        return

    gpu = int(os.environ.get("LINGBO_GPU_ID", "0") or "0")
    cuda = bool(torch.cuda.is_available())
    device = torch.device(f"cuda:{gpu}" if cuda else "cpu")
    unet_path = os.path.join(root, "models", "musetalkV15", "unet.pth")
    unet_config = os.path.join(root, "models", "musetalkV15", "musetalk.json")
    whisper_dir = os.path.join(root, "models", "whisper")
    if not (os.path.isfile(unet_path) and os.path.isfile(unet_config)):
        _emit({"ready": False, "cuda": cuda, "error": "weights_missing"})
        return
    try:
        vae, unet, pe = load_all_model(
            unet_model_path=unet_path,
            vae_type="sd-vae",
            unet_config=unet_config,
            device=device,
        )
        use_fp16 = cuda and os.environ.get("LINGBO_MUSETALK_FP32", "") != "1"
        if use_fp16:
            pe = pe.half()
            vae.vae = vae.vae.half()
            unet.model = unet.model.half()
        pe = pe.to(device)
        vae.vae = vae.vae.to(device)
        unet.model = unet.model.to(device)
        timesteps = torch.tensor([0], device=device)
        audio_processor = AudioProcessor(feature_extractor_path=whisper_dir)
        weight_dtype = unet.model.dtype
        whisper = WhisperModel.from_pretrained(whisper_dir)
        whisper = whisper.to(device=device, dtype=weight_dtype).eval()
        whisper.requires_grad_(False)
        face_parser = FaceParsing(left_cheek_width=90, right_cheek_width=90)
    except Exception as error:
        _emit({"ready": False, "cuda": cuda, "error": f"load_failed: {error}"})
        return

    cache_root = os.environ.get("LINGBO_CACHE", os.path.join(root, "results", "lingbo-cache"))
    os.makedirs(cache_root, exist_ok=True)
    batch_size = int(os.environ.get("LINGBO_MUSETALK_BATCH", "8") or "8")
    extra_margin = 10
    _emit({"ready": True, "cuda": cuda, "error": ""})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
            video = _render(
                job,
                vae=vae,
                unet=unet,
                pe=pe,
                whisper=whisper,
                audio_processor=audio_processor,
                face_parser=face_parser,
                timesteps=timesteps,
                device=device,
                weight_dtype=weight_dtype,
                cache_root=cache_root,
                batch_size=batch_size,
                extra_margin=extra_margin,
                coord_placeholder=coord_placeholder,
                get_landmark_and_bbox=get_landmark_and_bbox,
                get_image=get_image,
                datagen=datagen,
                cv2=cv2,
                np=np,
                torch=torch,
            )
            _emit({"ok": True, "video": video})
        except Exception as error:
            _emit({"ok": False, "error": str(error)})


def _render(job: dict[str, Any], **deps: Any) -> str:
    portrait = str(job["portrait"])
    audio = str(job["audio"])
    output = str(job["output"])
    fps = int(job.get("fps") or 25)
    if not os.path.isfile(portrait) or not os.path.isfile(audio):
        raise FileNotFoundError("portrait_or_audio_missing")
    digest = _sha256(portrait)
    cache_dir = os.path.join(deps["cache_root"], digest)
    os.makedirs(cache_dir, exist_ok=True)
    latents_path = os.path.join(cache_dir, "latents.pt")
    coords_path = os.path.join(cache_dir, "coords.pkl")
    frame = deps["cv2"].imread(portrait)
    if frame is None:
        raise RuntimeError("portrait_unreadable")
    if os.path.isfile(latents_path) and os.path.isfile(coords_path):
        input_latent_list = deps["torch"].load(latents_path, map_location=deps["device"])
        with open(coords_path, "rb") as handle:
            coord_list = pickle.load(handle)
        frame_list = [frame]
    else:
        coord_list, frame_list = deps["get_landmark_and_bbox"]([portrait], 0)
        input_latent_list = []
        kept: list[Any] = []
        for bbox, source in zip(coord_list, frame_list):
            if bbox == deps["coord_placeholder"]:
                continue
            x1, y1, x2, y2 = [int(v) for v in bbox]
            y2 = min(y2 + deps["extra_margin"], source.shape[0])
            crop = source[y1:y2, x1:x2]
            if crop.size == 0:
                continue
            crop = deps["cv2"].resize(crop, (256, 256), interpolation=deps["cv2"].INTER_LANCZOS4)
            input_latent_list.append(deps["vae"].get_latents_for_unet(crop))
            kept.append([x1, y1, x2, y2])
        if not input_latent_list:
            raise RuntimeError("no_face")
        coord_list = kept
        frame_list = [frame_list[0]]
        deps["torch"].save(input_latent_list, latents_path)
        with open(coords_path, "wb") as handle:
            pickle.dump(coord_list, handle)

    latent_cycle = input_latent_list + input_latent_list[::-1]
    coord_cycle = coord_list + coord_list[::-1]
    frame_cycle = frame_list + frame_list[::-1]
    features, length = deps["audio_processor"].get_audio_feature(audio)
    chunks = deps["audio_processor"].get_whisper_chunk(
        features,
        deps["device"],
        deps["weight_dtype"],
        deps["whisper"],
        length,
        fps=fps,
        audio_padding_length_left=2,
        audio_padding_length_right=2,
    )
    gen = deps["datagen"](
        whisper_chunks=chunks,
        vae_encode_latents=latent_cycle,
        batch_size=deps["batch_size"],
        delay_frame=0,
        device=deps["device"],
    )
    frames: list[Any] = []
    total = int(deps["np"].ceil(float(len(chunks)) / deps["batch_size"]))
    for whisper_batch, latent_batch in gen:
        audio_feature = deps["pe"](whisper_batch)
        latent_batch = latent_batch.to(dtype=deps["unet"].model.dtype)
        pred = deps["unet"].model(latent_batch, deps["timesteps"], encoder_hidden_states=audio_feature).sample
        recon = deps["vae"].decode_latents(pred)
        frames.extend(recon)
        del total
    if not frames:
        raise RuntimeError("no_frames")
    height, width = frame_cycle[0].shape[:2]
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    ffmpeg = subprocess.Popen(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "-s",
            f"{width}x{height}",
            "-r",
            str(fps),
            "-i",
            "pipe:0",
            "-i",
            audio,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-shortest",
            output,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    assert ffmpeg.stdin is not None
    for index, res_frame in enumerate(frames):
        bbox = coord_cycle[index % len(coord_cycle)]
        ori = frame_cycle[index % len(frame_cycle)].copy()
        x1, y1, x2, y2 = [int(v) for v in bbox]
        y2 = min(y2, ori.shape[0])
        try:
            resized = deps["cv2"].resize(res_frame.astype("uint8"), (max(1, x2 - x1), max(1, y2 - y1)))
        except Exception:
            continue
        combined = deps["get_image"](ori, resized, [x1, y1, x2, y2], mode="jaw", fp=deps["face_parser"])
        if combined.shape[0] != height or combined.shape[1] != width:
            combined = deps["cv2"].resize(combined, (width, height))
        ffmpeg.stdin.write(combined.tobytes())
    ffmpeg.stdin.close()
    err = ffmpeg.stderr.read().decode("utf-8", "replace") if ffmpeg.stderr else ""
    code = ffmpeg.wait(timeout=120)
    if code != 0 or not os.path.isfile(output):
        raise RuntimeError(err.strip() or f"ffmpeg_exit_{code}")
    return output


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:16]


if __name__ == "__main__":
    main()
