import {
  CeleryIcon,
  DjangoIcon,
  DockerIcon,
  KubernetesIcon,
  PostgresqlIcon,
  TerraformIcon,
} from './BrandIcons.tsx'

const BRAND_ICONS = {
  django: DjangoIcon,
  celery: CeleryIcon,
  docker: DockerIcon,
  kubernetes: KubernetesIcon,
  terraform: TerraformIcon,
  postgresql: PostgresqlIcon,
} as const

type BrandIconKey = keyof typeof BRAND_ICONS

export { BRAND_ICONS, type BrandIconKey }
