import {
  PreviewRunUseCase,
  type PreviewRunRequest,
  type PreviewRunUseCaseDeps,
} from './preview_run_use_case.ts'

export type PreviewSourceRequest = PreviewRunRequest

export type PreviewSourceUseCaseDeps = PreviewRunUseCaseDeps

export class PreviewSourceUseCase extends PreviewRunUseCase {}
