import { cn } from '@/lib/utils'
import { MCPServerStatus } from '@/packages/mcp/types'
import { Tooltip } from '@mantine/core'
import { FC } from 'react'

const MCPStatus: FC<{ status: MCPServerStatus | null }> = ({ status }) => {
  if (status?.error) {
    return (
      <Tooltip label={status.error} withArrow color="chatbox-error" multiline w={260}>
        <div className="rounded-full size-[6.6px] bg-red-500" />
      </Tooltip>
    )
  }
  return (
    <div
      className={cn(
        'rounded-full size-[6.6px]',
        (!status || status?.state === 'idle') && 'bg-gray-500',
        status?.state === 'running' && 'bg-green-500',
        status?.state === 'starting' && 'bg-blue-500 animate-pulse',
        status?.state === 'stopping' && 'bg-yellow-500 animate-pulse',
        status?.error && 'bg-red-500'
      )}
    />
  )
}

export default MCPStatus
