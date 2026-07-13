from .celery import app as celery_app

# __all__ 宣告「這個套件對外公開的名字」。這裡把 celery_app 放進去，
# 表示它是 durable_queue 套件的公開介面之一
__all__ = ("celery_app",)
