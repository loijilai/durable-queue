#!/usr/bin/env python3
"""設定清單三方對帳：程式碼 ↔ .env.example ↔ 部署來源。

    python3 scripts/check_env_parity.py

規則：
  required（程式碼裡 os.environ["X"]，沒有 default）
      → 必須同時出現在 .env.example 和部署來源
  optional（os.environ.get("X", ...)，有 default）
      → 只要求出現在 .env.example，讓那份清單保持完整可讀
  部署來源裡多餘的宣告
      → 程式碼從來不讀 = 死設定，一併報出來（LIBRARY_OWNED 例外，見下）

部署來源是可替換的 DeploymentSource：換掉它指到的路徑和解析規則，就能改對帳去對
別的部署宣告，不必碰其餘的對帳邏輯。05 把預設來源從機器開機腳本換成 Worker 的
ECS task definition；Worker 改成 Lambda 之後，來源換成那個 function 的環境設定
（infra/worker.tf），機器開機腳本與 task definition 對應的解析規則一併移除。
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "durable_queue"
ENV_EXAMPLE = APP / ".env.example"

REQUIRED_RE = re.compile(r'os\.environ\[\s*"([A-Z_][A-Z0-9_]*)"\s*\]')
OPTIONAL_RE = re.compile(r'os\.environ\.get\(\s*"([A-Z_][A-Z0-9_]*)"')
ENV_KEY_RE = re.compile(r"^([A-Z_][A-Z0-9_]*)=", re.MULTILINE)
# Lambda 的環境設定是 HCL map（`environment { variables = { FOO = ... } }`），
# 所以配對的是 HCL 的鍵。同一個檔案裡由 handler 冷啟動解析的機密也是一份 HCL
# map（worker_secret_env_sources），鍵的形狀相同，因此兩者一起被認出來——對帳
# 要看的是「這個函式跑起來會有哪些環境變數」，不分它是明文還是機密。只認全大寫
# 加底線，天然排除檔案裡一堆小寫連字號的 resource / attribute 名稱。
LAMBDA_ENV_RE = re.compile(r"^\s*([A-Z_][A-Z0-9_]*)\s*=", re.MULTILINE)

# 由依賴而非我們的程式碼讀取的環境變數：部署宣告裡有它，程式碼裡搜不到，卻不是
# 死設定。XDG_CACHE_HOME 是 yt-dlp 的 cache 路徑，Lambda 上必須指到唯一可寫的
# /tmp（見 infra/worker.tf）。
LIBRARY_OWNED = {"XDG_CACHE_HOME"}


@dataclass(frozen=True)
class DeploymentSource:
    """對帳的第三方：哪份檔案宣告了會被送進 runtime 的環境變數，以及怎麼從中解析出變數名稱。"""

    label: str
    path: Path
    pattern: re.Pattern[str]

    def declared(self) -> set[str]:
        return set(self.pattern.findall(self.path.read_text(encoding="utf-8")))


# Worker 是 Lambda，部署宣告是那個 function 的環境設定。API 共用同一份
# settings.py，需要的環境變數集合完全相同，所以對帳只需要盯著其中一份部署宣告。
_WORKER_LAMBDA_PATH = ROOT / "infra" / "worker.tf"
LAMBDA_ENVIRONMENT_SOURCE = DeploymentSource(
    label=str(_WORKER_LAMBDA_PATH.relative_to(ROOT)),
    path=_WORKER_LAMBDA_PATH,
    pattern=LAMBDA_ENV_RE,
)


def scan_code() -> tuple[set[str], set[str]]:
    """回傳 (required, optional)。測試自己準備環境，不算需求來源。"""
    required: set[str] = set()
    optional: set[str] = set()
    for path in APP.rglob("*.py"):
        if "tests" in path.parts or path.name.startswith("test_"):
            continue
        text = path.read_text(encoding="utf-8")
        required |= set(REQUIRED_RE.findall(text))
        optional |= set(OPTIONAL_RE.findall(text))
    # 同一個變數兩種讀法都有時，以「有 default」為準
    return required - optional, optional


def report(label: str, missing: set[str]) -> bool:
    if not missing:
        return True
    print(f"✗ {label}")
    for name in sorted(missing):
        print(f"    {name}")
    return False


def reconcile(
    required: set[str],
    optional: set[str],
    documented: set[str],
    deployment_source: DeploymentSource,
) -> bool:
    deployed = deployment_source.declared()

    ok = True
    ok &= report(
        f"程式碼需要但 {ENV_EXAMPLE.relative_to(ROOT)} 沒有記載：",
        (required | optional) - documented,
    )
    ok &= report(
        f"程式碼需要但 {deployment_source.label} 沒有宣告："
        "（缺了會讓部署的 process 起不來，或在執行時才爆）",
        required - deployed,
    )
    ok &= report(
        f"{deployment_source.label} 傳了但程式碼從來不讀（死設定）：",
        deployed - required - optional - LIBRARY_OWNED,
    )

    if ok:
        print(f"✓ 設定清單一致：" f"{len(required)} 個必要 + {len(optional)} 個選用")
    else:
        print("\n三份清單必須同步：程式碼、.env.example、" f"{deployment_source.label}")
    return ok


def main(deployment_source: DeploymentSource = LAMBDA_ENVIRONMENT_SOURCE) -> int:
    required, optional = scan_code()
    documented = set(ENV_KEY_RE.findall(ENV_EXAMPLE.read_text(encoding="utf-8")))
    ok = reconcile(required, optional, documented, deployment_source)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
