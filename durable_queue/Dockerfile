# syntax=docker/dockerfile:1
# =====================================================================
# Stage 1：編出 awslambdaric 的 wheel
# ---------------------------------------------------------------------
# Lambda 用 container image 部署時，image 自己要負責跟 Lambda 的 invoke
# API 對話，那就是 awslambdaric（runtime interface client）。它只以 sdist
# 發佈，安裝時要編譯一個 C++ extension，連帶自己建一份靜態 curl，需要
# cmake / g++ / autotools 一整套 toolchain。那套東西只有建置時用得到，所以
# 關在這個 stage 裡，最終 image 只帶走編好的 wheel。
#
# 不寫進 requirements.txt：它不是應用程式的依賴，而是這份 image 要能被
# Lambda 叫起來的條件。寫進去會讓每個從 requirements.txt 建 venv 的地方
# （scripts/verify.sh、CI）都得備齊這套 toolchain。
# =====================================================================
FROM python:3.13-slim AS lambdaric

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make cmake autoconf automake libtool \
    && rm -rf /var/lib/apt/lists/*

RUN pip wheel --no-cache-dir --wheel-dir /wheels awslambdaric==4.0.4


# =====================================================================
# 後端 image：api 與 worker 共用同一份（build once, run many）
# ---------------------------------------------------------------------
# API 在 ECS/Fargate 上跑 gunicorn（見 infra/api.tf 的 command），Worker 是
# Lambda，由 infra/worker.tf 的 image_config 覆寫 entrypoint 指向
# awslambdaric 與 handler。兩個角色共用同一個 tag，不可能跑到不同的程式碼。
# =====================================================================
FROM python:3.13-slim

# PYTHONDONTWRITEBYTECODE=1
#   在容器執行期間產生 .pyc。
#   runtime 產生的 .pyc 只存在於該容器的 writable layer，容器重建後不會保留，效益有限。
# PYTHONUNBUFFERED=1
#   stdout/stderr 不緩衝，log 即時吐出來（12-Factor: log as stream）
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# ffmpeg：TRANSCRIBER=real 時 yt-dlp/音檔切片都要靠它，TRANSCRIBER=fake 用不到
# 但兩種角色共用同一份 image，所以固定裝好。
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 依賴套件
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Lambda runtime interface client：用 stage 1 編好的 wheel，不在這裡重編
RUN --mount=from=lambdaric,source=/wheels,target=/wheels \
    pip install --no-cache-dir --no-index --find-links /wheels awslambdaric

# 專案程式碼
COPY . .

# 對外服務的 port（文件用途，實際對外見 docker-compose）
EXPOSE 8000
