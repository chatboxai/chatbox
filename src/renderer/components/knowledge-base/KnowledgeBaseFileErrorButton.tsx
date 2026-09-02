import NiceModal from '@ebay/nice-modal-react'
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'

interface KnowledgeBaseFileErrorButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children' | 'title' | 'type'> {
  children: ReactNode
  errorCode: string
  fileName: string
  label: string
}

export const KnowledgeBaseFileErrorButton = forwardRef<HTMLButtonElement, KnowledgeBaseFileErrorButtonProps>(
  ({ children, className, errorCode, fileName, label, onClick, ...buttonProps }, ref) => (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex cursor-pointer items-center border-0 bg-transparent p-0 ${className ?? ''}`}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) {
          return
        }
        event.stopPropagation()
        void NiceModal.show('file-parse-error', { errorCode, fileName })
      }}
    >
      {children}
    </button>
  )
)

KnowledgeBaseFileErrorButton.displayName = 'KnowledgeBaseFileErrorButton'
