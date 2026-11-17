// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { getThemeDesign } from './useAppTheme'

describe('getThemeDesign', () => {
  it('uses the interface brand color for MUI primary controls', () => {
    expect(getThemeDesign('light', 'en').palette?.primary).toEqual({ main: '#228be6' })
    expect(getThemeDesign('dark', 'en').palette?.primary).toEqual({ main: '#228be6' })
    expect(getThemeDesign('light', 'en', '#d97757').palette?.primary).toEqual({ main: '#d97757' })
  })

  it('paints MUI surfaces with the interface background and no elevation overlay', () => {
    const design = getThemeDesign('dark', 'en', '#e89173', '#262624')
    expect(design.palette?.background).toEqual({ default: '#262624', paper: '#262624' })
    expect(design.components?.MuiPaper?.styleOverrides?.root).toEqual({ backgroundImage: 'none' })
    expect(getThemeDesign('light', 'en', '#d97757', '#f7f6f2').palette?.background).toEqual({
      default: '#f7f6f2',
      paper: '#f7f6f2',
    })
  })
})
