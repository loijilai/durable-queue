#!/usr/bin/env python3
"""設定清單三方對帳：程式碼 ↔ .env.example ↔ 部署來源。

    python3 scripts/check_env_parity.py

規則：
  required（程式碼裡 os.environ["X"]，沒有 default）
      → 必須同時出現在 .env.example 和部署來源
  optional（os.environ.get("X", ...)，有 default）
      → 只要求出現在 .env.example，讓那份清單保持完整可讀
  部署來源裡多餘的宣告
      → 程式碼從來不讀 = 死設定，一併報出來

部署來源（目前是機器開機腳本 infra/user_data.sh.tftpl）是可替換的 DeploymentSource：
換掉它指到的路徑和解析規則，就能改對帳去對別的部署宣告（例如 ECS task
definition），不必碰其餘的對帳邏輯。
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
DOCKER_ENV_RE = re.compile(r"-e\s+([A-Z_][A-Z0-9_]*)=")


@dataclass(frozen=True)
class DeploymentSource:
    """對帳的第三方：哪份檔案宣告了會被送進 runtime 的環境變數，以及怎麼從中解析出變數名稱。"""

    label: str
    path: Path
    pattern: re.Pattern[str]

    def declared(self) -> set[str]:
        return set(self.pattern.findall(self.path.read_text(encoding="utf-8")))


_USER_DATA_PATH = ROOT / "infra" / "user_data.sh.tftpl"
USER_DATA_SOURCE = DeploymentSource(
    label=str(_USER_DATA_PATH.relative_to(ROOT)),
    path=_USER_DATA_PATH,
    pattern=DOCKER_ENV_RE,
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
        f"程式碼需要但 {deployment_source.label} 沒有傳進 container："
        "（缺了會讓 EC2 上的 process 起不來，或在執行 task 時才爆）",
        required - deployed,
    )
    ok &= report(
        f"{deployment_source.label} 傳了但程式碼從來不讀（死設定）：",
        deployed - required - optional,
    )

    if ok:
        print(f"✓ 設定清單一致：" f"{len(required)} 個必要 + {len(optional)} 個選用")
    else:
        print("\n三份清單必須同步：程式碼、.env.example、" f"{deployment_source.label}")
    return ok


def main(deployment_source: DeploymentSource = USER_DATA_SOURCE) -> int:
    required, optional = scan_code()
    documented = set(ENV_KEY_RE.findall(ENV_EXAMPLE.read_text(encoding="utf-8")))
    ok = reconcile(required, optional, documented, deployment_source)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
