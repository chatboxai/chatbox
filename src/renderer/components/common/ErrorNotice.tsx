import type { ReactNode } from 'react'
import errorIcon from '@/static/images/errors/err-icon-red.png'
import infoIcon from '@/static/images/errors/info-icon-red.png'
import classes from './ErrorNotice.module.css'

export function ErrorNotice({
  children,
  icon = 'info',
  testId,
}: {
  children: ReactNode
  icon?: 'info' | 'error'
  testId?: string
}) {
  return (
    <div role="alert" data-testid={testId} className={classes.notice}>
      <img className={classes.icon} src={icon === 'error' ? errorIcon : infoIcon} alt="" />
      <div className={classes.content}>{children}</div>
    </div>
  )
}
