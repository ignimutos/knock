export interface MailTransport {
  sendMail(message: unknown): Promise<unknown>
}

export type CreateTransport = (options: unknown) => MailTransport

interface NodemailerModule {
  createTransport?: CreateTransport
  default?: {
    createTransport?: CreateTransport
  }
}

const specifier =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'nodemailer' : 'npm:nodemailer'
const mod = (await import(specifier)) as NodemailerModule
const createTransportImpl = mod.default?.createTransport ?? mod.createTransport

if (typeof createTransportImpl !== 'function') {
  throw new Error('nodemailer.createTransport 不可用')
}

export const createTransport = createTransportImpl
