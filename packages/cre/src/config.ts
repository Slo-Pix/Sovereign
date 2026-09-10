import { z } from 'zod'
import { address, bytes32, termsSchema } from './domain'
import { isPositionOrigin } from './position-endpoint'

export const configSchema = z.object({
  schedule: z.string().min(1),
  agreementId: bytes32,
  agreementRegistry: address,
  intentRegistry: address,
  decisionSink: address,
  policySecretId: z.string().min(1),
  positionAuthSecretId: z.string().min(1).max(128),
  terms: termsSchema,
  // The route is derived from agreementId; there is no caller-controlled path or query.
  positionOrigin: z.string().max(280),
  allowInsecurePositionLoopback: z.boolean().default(false),
  maxPositionAgeSeconds: z.number().int().positive().max(300).default(30),
  delivery: z.enum(['report-only', 'sepolia']).default('report-only'),
  // An onReport receiver, NOT the current DecisionSink. Configure only after Member A deploys it.
  reportReceiver: address.optional(),
}).strict().superRefine((config, ctx) => {
  if (!isPositionOrigin(config.positionOrigin, config.allowInsecurePositionLoopback) ||
      (config.allowInsecurePositionLoopback && config.delivery !== 'report-only')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid position origin or insecure delivery mode' })
  }
  if (config.positionAuthSecretId === config.policySecretId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Position and policy secrets must be separate' })
  }
  if (config.delivery === 'sepolia' && (!config.reportReceiver ||
      config.reportReceiver.toLowerCase() === config.decisionSink.toLowerCase())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A separate authenticated onReport receiver is required' })
  }
})
export type Config = z.infer<typeof configSchema>