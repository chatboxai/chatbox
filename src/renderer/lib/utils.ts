import { type ClassValue, clsx } from 'clsx'
import dayjs from 'dayjs'
import { getDefaultStore } from 'jotai'
import { twMerge } from 'tailwind-merge'
import platform from '@/platform'
import { initLogAtom } from '@/stores/atoms/utilAtoms'

// Re-export from shared layer for backward compatibility
export { parseJsonOrEmpty } from '../../shared/utils/json_utils'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getLogger(logId: string) {
  // const logger = log.create({ logId })
  // logger.transports.console.format = '{h}:{i}:{s}.{ms} › [{logId}] › {text}'
  // return logger
  return {
    log(level: string, ...args: any[]) {
      const store = getDefaultStore()
      const now = dayjs().format('HH:mm:ss.SSS')
      store.set(initLogAtom, [...store.get(initLogAtom), `[${now}][${logId}] ${args.join(' ')}`])
      platform.appLog(level, args.join(' ')).catch((e) => {
        console.error('Failed to send log to main process', e)
      })
    },
    info(...args: any[]) {
      this.log('info', ...args)
    },
    warn(...args: any[]) {
      this.log('warn', ...args)
    },
    error(...args: any[]) {
      this.log('error', ...args)
    },
    debug(...args: any[]) {
      console.debug('debug', ...args)
    },
  }
}
