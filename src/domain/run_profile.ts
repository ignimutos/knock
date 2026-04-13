export type RunProfile = 'production' | 'preview'

export type EffectDomain = 'production' | 'preview'

export type RunTrigger = 'scheduled' | 'immediate' | 'manual' | 'preview'

export interface RunContextAlignment {
  profile: RunProfile
  effectDomain: EffectDomain
  trigger: RunTrigger
}

export function assertRunContextAlignment(input: RunContextAlignment): void {
  if (input.profile === 'preview') {
    if (input.effectDomain !== 'preview') {
      throw new Error('preview profile 必须使用 preview effectDomain')
    }

    if (input.trigger !== 'preview') {
      throw new Error('preview profile 必须使用 preview trigger')
    }

    return
  }

  if (input.effectDomain !== 'production') {
    throw new Error('production profile 必须使用 production effectDomain')
  }

  if (input.trigger === 'preview') {
    throw new Error('preview trigger 只能用于 preview profile')
  }
}
