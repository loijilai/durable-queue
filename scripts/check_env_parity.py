#!/usr/bin/env python3
"""設定清單三方對帳：程式碼 ↔ .env.example ↔ Terraform user_data。

    python3 scripts/check_env_parity.py

規則：
  required（程式碼裡 os.environ["X"]，沒有 default）
      → 必須同時出現在 .env.example 和 user_data.sh.tftpl
  optional（os.environ.get("X", ...)，有 default）
      → 只要求出現在 .env.example，讓那份清單保持完整可讀
  user_data 裡多餘的 -e
      → 程式碼從來不讀 = 死設定，一併報出來
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "durable_queue"
ENV_EXAMPLE = APP / ".env.example"
USER_DATA = ROOT / "infra" / "user_data.sh.tftpl"

REQUIRED_RE = re.compile(r'os\.environ\[\s*"([A-Z_][A-Z0-9_]*)"\s*\]')
OPTIONAL_RE = re.compile(r'os\.environ\.get\(\s*"([A-Z_][A-Z0-9_]*)"')
ENV_KEY_RE = re.compile(r"^([A-Z_][A-Z0-9_]*)=", re.MULTILINE)
DOCKER_ENV_RE = re.compile(r"-e\s+([A-Z_][A-Z0-9_]*)=")


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


def main() -> int:
    required, optional = scan_code()
    documented = set(ENV_KEY_RE.findall(ENV_EXAMPLE.read_text(encoding="utf-8")))
    deployed = set(DOCKER_ENV_RE.findall(USER_DATA.read_text(encoding="utf-8")))

    ok = True
    ok &= report(
        f"程式碼需要但 {ENV_EXAMPLE.relative_to(ROOT)} 沒有記載：",
        (required | optional) - documented,
    )
    ok &= report(
        f"程式碼需要但 {USER_DATA.relative_to(ROOT)} 沒有傳進 container："
        "（缺了會讓 EC2 上的 process 起不來，或在執行 task 時才爆）",
        required - deployed,
    )
    ok &= report(
        f"{USER_DATA.relative_to(ROOT)} 傳了但程式碼從來不讀（死設定）：",
        deployed - required - optional,
    )

    if ok:
        print(f"✓ 設定清單一致：" f"{len(required)} 個必要 + {len(optional)} 個選用")
        return 0
    print("\n三份清單必須同步：程式碼、.env.example、infra/user_data.sh.tftpl")
    return 1


if __name__ == "__main__":
    sys.exit(main())
