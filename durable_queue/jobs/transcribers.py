import time


def fake_transcribe(video_url):
    time.sleep(1)
    raise ValueError("Error!")
    return "This is a test script"
