import { basename, dirname, extname, join } from '@std/path'
import { z } from 'zod'
import { parseDurationMs, resolveRuntimePath } from '../config/runtime_semantics.ts'
import type { FileRotationConfig } from '../config/schema.ts'
import { getLogFields, type Logger } from '../core/logger.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'

export interface FileDeliveryFactoryOptions {
  runtimeDir: string
  logger?: Logger
}

export interface FileDeliveryRequest {
  path: string
  content: string
  rotation?: FileRotationConfig
  templateContext?: Record<string, unknown>
}

export interface FileDelivery {
  push(req: FileDeliveryRequest): Promise<void>
}

function formatRotationTime(input: Date): string {
  const yyyy = `${input.getUTCFullYear()}`
  const mm = `${input.getUTCMonth() + 1}`.padStart(2, '0')
  const dd = `${input.getUTCDate()}`.padStart(2, '0')
  const hh = `${input.getUTCHours()}`.padStart(2, '0')
  const mi = `${input.getUTCMinutes()}`.padStart(2, '0')
  const ss = `${input.getUTCSeconds()}`.padStart(2, '0')
  const ms = `${input.getUTCMilliseconds()}`.padStart(3, '0')
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}${ms}Z`
}

const rotationSizeSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (
      !value
        .trim()
        .toLowerCase()
        .match(/^(\d+)(b|k|m|g)$/)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `rotation.size 配置非法: ${value}`,
      })
    }
  })
  .transform((value) => value.trim().toLowerCase())

function parseSizeBytes(input: string): number {
  const normalized = parseWithFirstIssue(
    rotationSizeSchema,
    input,
    `rotation.size 配置非法: ${input}`,
  )
  const [, amountText, unit] = normalized.match(/^(\d+)(b|k|m|g)$/) ?? []
  const amount = Number(amountText)
  if (unit === 'b') return amount
  if (unit === 'k') return amount * 1024
  if (unit === 'm') return amount * 1024 * 1024
  return amount * 1024 * 1024 * 1024
}

/**
 * 轮转文件名固定为“原文件名 + UTC 时间戳 + 原扩展名”。
 * 这样生成的备份名按字典序排序时，顺序就与时间先后完全一致，可直接用于按最老优先清理。
 */
function buildRotatedPath(targetPath: string, now: Date): string {
  const ext = extname(targetPath)
  const dir = dirname(targetPath)
  const baseName = basename(targetPath, ext)
  const timestamp = formatRotationTime(now)
  return join(dir, ext ? `${baseName}.${timestamp}${ext}` : `${baseName}.${timestamp}`)
}

function detectRotationReason(
  fileInfo: Deno.FileInfo,
  rotation: FileRotationConfig,
): 'size' | 'age' | 'none' {
  const exceedsSizeLimit = rotation.size ? fileInfo.size >= parseSizeBytes(rotation.size) : false
  if (exceedsSizeLimit) return 'size'
  const exceedsAgeLimit = rotation.age
    ? Date.now() - (fileInfo.mtime?.getTime() ?? Date.now()) >=
      parseDurationMs(rotation.age, 'rotation.age')
    : false
  if (exceedsAgeLimit) return 'age'
  return 'none'
}

async function resolveRotationDecision(
  targetPath: string,
  rotation: FileRotationConfig,
): Promise<{ shouldRotate: boolean; reason: 'size' | 'age' | 'none' }> {
  let fileInfo: Deno.FileInfo
  try {
    fileInfo = await Deno.stat(targetPath)
  } catch {
    return { shouldRotate: false, reason: 'none' }
  }

  if (!fileInfo.isFile) return { shouldRotate: false, reason: 'none' }

  const reason = detectRotationReason(fileInfo, rotation)
  return { shouldRotate: reason !== 'none', reason }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildBackupFilenamePattern(targetPath: string): RegExp {
  const ext = extname(targetPath)
  const name = basename(targetPath, ext)
  return new RegExp(`^${escapeRegExp(name)}\\.\\d{8}T\\d{9}Z${escapeRegExp(ext)}$`)
}

async function pruneBackups(targetPath: string, backups: number): Promise<void> {
  if (backups < 0) return

  const dir = dirname(targetPath)
  const pattern = buildBackupFilenamePattern(targetPath)

  const files: string[] = []
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile) continue
    if (pattern.test(entry.name)) files.push(entry.name)
  }

  files.sort()
  const removeCount = files.length - backups
  if (removeCount <= 0) return

  for (let i = 0; i < removeCount; i += 1) {
    await Deno.remove(join(dir, files[i]))
  }
}

export function createFileDelivery(options: FileDeliveryFactoryOptions): FileDelivery {
  return {
    async push(req: FileDeliveryRequest): Promise<void> {
      const targetPath = resolveRuntimePath(options.runtimeDir, req.path)
      await Deno.mkdir(dirname(targetPath), { recursive: true })

      const logFields = {
        ...(req.templateContext ? (getLogFields(req.templateContext) ?? {}) : {}),
        path: targetPath,
      }

      const rotation = req.rotation
      if (rotation?.enabled) {
        const decision = await resolveRotationDecision(targetPath, rotation)
        options.logger?.debug('检查文件轮转', {
          operation: 'rotation_check',
          outcome: decision.shouldRotate ? 'triggered' : 'skipped',
          ...logFields,
          rotation_enabled: true,
          rotation_reason: decision.reason,
        })

        if (decision.shouldRotate) {
          const rotatedPath = buildRotatedPath(targetPath, new Date())
          await Deno.rename(targetPath, rotatedPath)
          options.logger?.debug('执行文件轮转', {
            operation: 'rotate_file',
            outcome: 'success',
            ...logFields,
            rotated_path: rotatedPath,
            rotation_enabled: true,
            rotation_reason: decision.reason,
          })
          if (typeof rotation.backups === 'number') {
            await pruneBackups(targetPath, rotation.backups)
            options.logger?.debug('清理轮转备份', {
              operation: 'prune_backups',
              outcome: 'success',
              ...logFields,
              rotation_enabled: true,
              rotation_reason: decision.reason,
            })
          }
        }
      }

      await Deno.writeTextFile(targetPath, `${req.content}\n`, {
        append: true,
      })
      options.logger?.info('写入文件成功', {
        operation: 'push',
        outcome: 'success',
        ...logFields,
        rotation_enabled: rotation?.enabled ?? false,
      })
    },
  }
}
