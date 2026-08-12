import {
  CeleryIcon,
  DjangoIcon,
  DockerIcon,
  KubernetesIcon,
  PostgresqlIcon,
  RedisIcon,
  TerraformIcon,
} from './BrandIcons.tsx'

const BRAND_ICONS = {
  django: DjangoIcon,
  celery: CeleryIcon,
  docker: DockerIcon,
  kubernetes: KubernetesIcon,
  terraform: TerraformIcon,
  postgresql: PostgresqlIcon,
  redis: RedisIcon,
} as const

type BrandIconKey = keyof typeof BRAND_ICONS

export { BRAND_ICONS, type BrandIconKey }
