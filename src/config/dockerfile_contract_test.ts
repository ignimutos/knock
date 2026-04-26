import { assertStringIncludes } from '@std/assert'

Deno.test('[contract] Dockerfile: 多架构发布必须在 BUILDPLATFORM 上交叉编译目标二进制', () => {
  const dockerfile = Deno.readTextFileSync(new URL('../../Dockerfile', import.meta.url))

  assertStringIncludes(
    dockerfile,
    'FROM --platform=$BUILDPLATFORM denoland/deno:${DENO_VERSION} AS build',
  )
  assertStringIncludes(dockerfile, 'ARG TARGETARCH')
  assertStringIncludes(dockerfile, 'DENO_COMPILE_TARGET=x86_64-unknown-linux-gnu')
  assertStringIncludes(dockerfile, 'DENO_COMPILE_TARGET=aarch64-unknown-linux-gnu')
  assertStringIncludes(dockerfile, '--target "$DENO_COMPILE_TARGET"')
})
