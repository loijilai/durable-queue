import os
import time


def fake_transcribe(video_url):
    time.sleep(int(os.environ["TRANSCRIBE_SECONDS"]))
    return "This is a test script"


def real_transcribe(video_url):
    raise NotImplementedError("real_transcribe 尚未實作")


def get_transcriber():
    return {"fake": fake_transcribe, "real": real_transcribe}[os.environ["TRANSCRIBER"]]
