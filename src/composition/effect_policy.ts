export interface EffectPolicy {
  persistFacts: boolean
  writeDedupe: boolean
  allowExternalSideEffects: boolean
  exposeToRecovery: boolean
  exposeToPrune: boolean
}

export const previewEffectPolicy: EffectPolicy = {
  persistFacts: false,
  writeDedupe: false,
  allowExternalSideEffects: false,
  exposeToRecovery: false,
  exposeToPrune: false,
}

export const productionEffectPolicy: EffectPolicy = {
  persistFacts: true,
  writeDedupe: true,
  allowExternalSideEffects: true,
  exposeToRecovery: true,
  exposeToPrune: true,
}
