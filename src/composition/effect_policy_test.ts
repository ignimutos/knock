import { assertEquals } from '@std/assert'
import { previewEffectPolicy, productionEffectPolicy } from './effect_policy.ts'
import { test } from '../testing/test_api.ts'

test('[contract] effect policy: preview 与 production 应保留稳定 side-effect 策略', () => {
  assertEquals(previewEffectPolicy, {
    persistFacts: false,
    writeDedupe: false,
    allowExternalSideEffects: false,
    exposeToRecovery: false,
    exposeToPrune: false,
  })

  assertEquals(productionEffectPolicy, {
    persistFacts: true,
    writeDedupe: true,
    allowExternalSideEffects: true,
    exposeToRecovery: true,
    exposeToPrune: true,
  })
})
