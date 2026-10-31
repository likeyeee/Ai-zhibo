FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    LINGBO_IN_DOCKER=1 \
    LINGBO_PORT=8790 \
    MUSETALK_ROOT=/models/MuseTalk

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt
COPY lingbo_avatar ./lingbo_avatar
COPY download_models.py .

EXPOSE 8790
CMD ["python3", "-m", "lingbo_avatar"]
