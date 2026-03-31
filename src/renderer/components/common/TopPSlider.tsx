import { useEffect, useId, useState } from 'react'
import { TextField, Slider, Typography, Box } from '@mui/material'
import { useTranslation } from 'react-i18next'

export interface Props {
  topP: number
  setTopP: (topP: number) => void
  className?: string
}

export default function TopPSlider(props: Props) {
  const { t } = useTranslation()
  const sliderId = useId()
  const [input, setInput] = useState('1')
  useEffect(() => {
    setInput(`${props.topP}`)
  }, [props.topP])
  const handleChange = (event: Event, newValue: number | number[], activeThumb: number) => {
    if (typeof newValue === 'number') {
      props.setTopP(newValue)
    } else {
      props.setTopP(newValue[activeThumb])
    }
  }
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    if (value === '' || value.endsWith('.')) {
      setInput(value)
      return
    }
    let num = parseFloat(value)
    if (isNaN(num)) {
      setInput(`${props.topP}`)
      return
    }
    if (num < 0 || num > 1) {
      setInput(`${props.topP}`)
      return
    }
    // 保留一位小数
    num = Math.round(num * 100) / 100
    setInput(num.toString())
    props.setTopP(num)
  }
  return (
    <Box sx={{ margin: '10px' }} className={props.className}>
      <Box>
        <Typography id={sliderId} gutterBottom>
          {t('Top P')}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          margin: '0 auto',
        }}
      >
        <Box sx={{ width: '92%' }}>
          <Slider
            value={props.topP}
            onChange={handleChange}
            aria-labelledby={sliderId}
            valueLabelDisplay="auto"
            defaultValue={props.topP}
            step={0.01}
            min={0}
            max={1}
          />
        </Box>
        <TextField
          sx={{ marginLeft: 2, width: '100px' }}
          value={input}
          onChange={handleInputChange}
          type="text"
          size="small"
          variant="outlined"
        />
      </Box>
    </Box>
  )
}
