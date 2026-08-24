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

部署來源是可替換的 DeploymentSource：換掉它指到的路徑和解析規則，就能改對帳去對
別的部署宣告，不必碰其餘的對帳邏輯。05 把預設來源從機器開機腳本換成 Worker 的
ECS task definition（infra/worker.tf 的 container_definitions）。06 把 API 也
搬上 Fargate、刪除了機器開機腳本本身，這裡對應的 DOCKER_ENV_RE / 舊來源就一併
移除。
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
# ECS task definition 是 HCL（container_definitions = jsonencode(...)），不是
# 字面 JSON，所以配對的是 `name = "FOO"` 而不是 `"name": "FOO"`。只認全大寫
# 加底線，天然排除同一個檔案裡一堆小寫連字號的 resource/container 名稱。
TASK_DEFINITION_ENV_RE = re.compile(r'name\s*=\s*"([A-Z_][A-Z0-9_]*)"')


@dataclass(frozen=True)
class DeploymentSource:
    """對帳的第三方：哪份檔案宣告了會被送進 runtime 的環境變數，以及怎麼從中解析出變數名稱。"""

    label: str
    path: Path
    pattern: re.Pattern[str]

    def declared(self) -> set[str]:
        return set(self.pattern.findall(self.path.read_text(encoding="utf-8")))


# Worker 不再是機器開機腳本，是 ECS/Fargate 的 task definition（05）。06 把
# API 也搬上 Fargate、共用同一份 settings.py，需要的環境變數集合完全相同，所以
# 對帳只需要盯著其中一份部署宣告。
_WORKER_TASK_DEFINITION_PATH = ROOT / "infra" / "worker.tf"
WORKER_TASK_DEFINITION_SOURCE = DeploymentSource(
    label=str(_WORKER_TASK_DEFINITION_PATH.relative_to(ROOT)),
    path=_WORKER_TASK_DEFINITION_PATH,
    pattern=TASK_DEFINITION_ENV_RE,
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
        "（缺了會讓 container 起不來，或在執行 task 時才爆）",
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


def main(deployment_source: DeploymentSource = WORKER_TASK_DEFINITION_SOURCE) -> int:
    required, optional = scan_code()
    documented = set(ENV_KEY_RE.findall(ENV_EXAMPLE.read_text(encoding="utf-8")))
    ok = reconcile(required, optional, documented, deployment_source)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
