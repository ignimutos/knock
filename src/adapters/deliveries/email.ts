import { getLogFields, type Logger } from '../../core/logger.ts'
import type { EmailConfig } from '../../config/schema.ts'
import {
  createTransport as createMailTransport,
  type CreateTransport,
} from '../../platform/nodemailer.ts'

export interface EmailDeliveryRequest {
  deliveryId: string
  smtp: EmailConfig['smtp']
  message: EmailConfig['message']
  templateContext?: Record<string, unknown>
}

export interface EmailDeliveryFactoryOptions {
  logger?: Logger
  createTransport?: CreateTransport
}

export interface EmailDelivery {
  push(req: EmailDeliveryRequest): Promise<void>
}

function toTransportOptions(smtp: EmailConfig['smtp']): Parameters<CreateTransport>[0] {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'implicit',
    requireTLS: smtp.security === 'starttls',
    auth: smtp.auth
      ? {
          user: smtp.auth.username,
          pass: smtp.auth.password,
        }
      : undefined,
  }
}

export function createEmailDelivery(options: EmailDeliveryFactoryOptions = {}): EmailDelivery {
  const createTransport = options.createTransport ?? createMailTransport

  return {
    async push(req: EmailDeliveryRequest): Promise<void> {
      const logFields = {
        ...(req.templateContext ? (getLogFields(req.templateContext) ?? {}) : {}),
        'delivery.id': req.deliveryId,
      }

      options.logger?.info('SMTP 邮件发送开始', {
        'delivery.operation': 'push',
        'delivery.outcome': 'start',
        ...logFields,
      })

      try {
        const transporter = createTransport(toTransportOptions(req.smtp))
        await transporter.sendMail({
          from: req.message.from,
          to: req.message.to,
          cc: req.message.cc,
          bcc: req.message.bcc,
          replyTo: req.message.replyTo,
          subject: req.message.subject,
          text: req.message.text,
          html: req.message.html,
          headers: req.message.headers,
        })

        options.logger?.info('SMTP 邮件发送成功', {
          'delivery.operation': 'push',
          'delivery.outcome': 'success',
          ...logFields,
          'delivery.recipient_count':
            req.message.to.length + (req.message.cc?.length ?? 0) + (req.message.bcc?.length ?? 0),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        options.logger?.error('SMTP 邮件发送失败', {
          'delivery.operation': 'push',
          'delivery.outcome': 'failure',
          ...logFields,
          error_name: error instanceof Error ? error.name : 'Error',
          error_message: message,
        })
        throw new Error(message)
      }
    },
  }
}
