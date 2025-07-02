import { Select, MenuItem, FormControl, InputLabel } from '@mui/material'
import * as React from 'react'

export interface Props<T extends string | number> {
  label: string | React.ReactNode
  value: T | undefined
  options: { value: T; label: React.ReactNode; style?: React.CSSProperties }[]
  onChange: (value: T | undefined) => void
  className?: string
  fullWidth?: boolean
  size?: 'small' | 'medium'
  style?: React.CSSProperties
}

export default function SimpleSelect<T extends string | number>(props: Props<T>) {
  const { fullWidth = true, size, style } = props
  return (
    <FormControl
      fullWidth={fullWidth}
      variant="outlined"
      margin="dense"
      className={props.className}
      size={size}
      style={style}
    >
      <InputLabel>{props.label}</InputLabel>
      <Select
        label={props.label}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
        MenuProps={{
          PaperProps: {
            style: {
              maxHeight: 'calc(50vh - 96px)',
            },
          },
        }}
      >
        {props.options.map((option) => (
          <MenuItem key={option.value} value={option.value} style={option.style}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
