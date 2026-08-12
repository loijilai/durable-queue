# Diagram manifest

本頁定義 diagram 的 source of truth、generator、output 與 consumer。只編輯
source；由 generator 產生的檔案不得手動修改。

## Ownership rules

- 文件專用的 editable source 放在 [`sources/`](sources/)。
- 文件顯示用、沒有 runtime consumer 的 PNG 放在 [`rendered/`](rendered/)。
- React 直接 import 的 Excalidraw JSON 是 application source，保留在
  `frontend/src/assets/diagrams/`。
- Browser 以 URL 載入的 SVG 放在 `frontend/public/diagrams/`；README 直接重用
  同一份 SVG，不另外複製。
- Generator 放在 `tools/diagrams/`，必須從 repository root 執行。

## Documentation and infrastructure diagrams

| Family | Editable source | Generator | Output | Consumer |
| --- | --- | --- | --- | --- |
| AWS infrastructure | [`sources/aws-infra.drawio`](sources/aws-infra.drawio) | Manual draw.io export | `frontend/public/diagrams/aws-infra.svg` | Root README, Home and HA pages, architecture doc |
| Security topology lenses | [`sources/security-topology.drawio`](sources/security-topology.drawio) | `python3 tools/diagrams/build_security_topology.py --export` | `frontend/public/diagrams/sec-topology-{network,sg,tls}.svg` | Root README and Security page |
| Deployment pipeline lenses | [`sources/deploy-pipeline.drawio`](sources/deploy-pipeline.drawio) | `python3 tools/diagrams/build_deploy_pipeline.py --export` | `frontend/public/diagrams/sec-pipeline-{1-seed,2-identity,3-image,4-state,5-boot}.svg` | Root README and Security page |
| Early lifecycle sketch | [`sources/job-lifecycle.excalidraw`](sources/job-lifecycle.excalidraw) | None; historical editable source | None | This manifest; current lifecycle is rendered below |

The early lifecycle sketch is retained as editable design provenance, not as
current architecture authority. [`../architecture.md`](../architecture.md)
is authoritative for current claims.

## Frontend Excalidraw scenes

All files below live in `frontend/src/assets/diagrams/` and are imported by
`frontend/src/lib/diagramScenes.ts`.

| Source family | Generator/output | Consumer |
| --- | --- | --- |
| `1-queue-arch`, `2-*`, `3-*`, `4-sequence-concurrency`, `5-scale-out` | Rendered at runtime; selected documentation snapshots live in [`rendered/`](rendered/) | Queue, durability, HA, scalability pages; root README and architecture doc |
| `auth-sequence-google-oidc.excalidraw` | Base scene rendered at runtime; documentation snapshot in `rendered/auth-sequence-google-oidc.png` | Auth page, root README, architecture doc |
| `8-auth-attack-{1-state,2-token,3-linking}.excalidraw` | `python3 tools/diagrams/build_auth_attacks.py`, derived from the base auth scene | Security page |

## Rendered documentation snapshots

These files are versioned because GitHub Markdown cannot render Excalidraw JSON:

- `1-queue-arch.png`
- `2-1-visibility-timeout.png`
- `2-worker-failure.png`
- `3-1-race-condition.png`
- `3-worker-stuck-duplicate.png`
- `4-sequence-concurrency.png`
- `5-scale-out.png`
- `auth-sequence-google-oidc.png`

They are consumed by the root README and/or current architecture document. When
a corresponding Excalidraw source changes, refresh its snapshot in the same change.
