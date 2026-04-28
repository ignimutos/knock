import nodemailer from 'nodemailer'

export interface MailTransport {
  sendMail(message: unknown): Promise<unknown>
}

export interface MailTransportOptions {
  host: string
  port: number
  secure: boolean
  requireTLS: boolean
  auth?: {
    user: string
    pass: string
  }
}

export type CreateTransport = (options: MailTransportOptions) => MailTransport

export const createTransport = nodemailer.createTransport as unknown as CreateTransport
