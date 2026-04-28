import { createRequire } from 'node:module'

export interface SqliteRunResult {
  changes: number | bigint
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase
}

interface BunSqliteModule {
  Database: new (path: string) => SqliteDatabase
}

const require = createRequire(import.meta.url)

export function openSqliteDatabase(path: string): SqliteDatabase {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') {
    const { Database } = require('bun:sqlite') as BunSqliteModule
    return new Database(path)
  }

  const { DatabaseSync } = require('node:sqlite') as NodeSqliteModule
  return new DatabaseSync(path)
}
