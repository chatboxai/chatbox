import type * as React from 'react'
import TextField from '@mui/material/TextField'
import Autocomplete from '@mui/material/Autocomplete'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import { cn } from '@/lib/utils'
import AddIcon from '@mui/icons-material/Add'

export default function CreatableSelect(props: {
  label: string | React.ReactNode
  value: string
  options: string[]
  onChangeValue: (value: string) => void
  onUpdateOptions: (options: string[]) => void
  className?: string
  // fullWidth?: boolean
  // size?: 'small' | 'medium'
  // style?: React.CSSProperties
}) {
  const { label, value, options, onChangeValue, onUpdateOptions, className } = props
  return (
    <Autocomplete
      value={value}
      onChange={(event, newValue) => {
        if (!newValue) {
          return
        }
        if (!options.includes(newValue)) {
          onUpdateOptions([newValue, ...options])
        }
        onChangeValue(newValue)
      }}
      filterOptions={(options, params) => {
        const filtereds = options
        // const filtereds = filter(options, params);
        const { inputValue } = params
        const isExisting = options.some((option) => inputValue === option)
        if (inputValue !== '' && !isExisting) {
          filtereds.unshift(inputValue)
        }
        return filtereds
      }}
      selectOnFocus
      // clearOnBlur
      handleHomeEndKeys
      options={options}
      getOptionLabel={(option) => {
        return option
      }}
      renderOption={(props, option) => {
        if (!options.includes(option)) {
          return (
            <li
              {...props}
              onClick={() => {
                onUpdateOptions([option, ...options])
              }}
            >
              <AddIcon color="primary" fontSize="small" className="mr-0.5" />
              {option}
            </li>
          )
        }
        return (
          <li
            {...props}
            className={cn('flex items-center justify-between px-4 py-1', 'hover:bg-gray-400/50 cursor-pointer')}
          >
            <span>{option}</span>
            <IconButton
              size="small"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onUpdateOptions(options.filter((o) => o !== option))
              }}
            >
              <CloseIcon fontSize="small" className="opacity-50 hover:opacity-100 hover:text-red-500" />
            </IconButton>
          </li>
        )
      }}
      freeSolo
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          value={value}
          margin="dense"
          type="text"
          fullWidth
          variant="outlined"
          onChange={(event) => {
            onChangeValue(event.target.value.trim())
          }}
          className={className}
        />
      )}
      className={className}
    />
  )
}
