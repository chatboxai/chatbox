export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerPort {
  log(level: LogLevel, message: string, context?: Record<string, unknown>): Promise<void> | void
}
