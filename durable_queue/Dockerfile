# 後端 image：api 與 worker 共用同一份（build once, run many）
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

# 專案程式碼
COPY . .

# 對外服務的 port（文件用途，實際對外見 docker-compose）
EXPOSE 8000
