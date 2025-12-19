import { useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import * as React from 'react'

function HomepageIcon(props: React.SVGProps<SVGSVGElement>) {
  const colorScheme = useComputedColorScheme()
  const isDark = colorScheme === 'dark'
  const fillColor = isDark ? '#7D90A1' : '#EDF0F2'
  const strokeColor = isDark ? '#45525F' : '#899AA9'

  return (
    <svg width={34} height={33} fill="none" {...props}>
      <mask id="prefix__a" maskUnits="userSpaceOnUse" x={-0.519} y={-0.316} width={35} height={34} fill="#000">
        <path fill="#fff" d="M-.519-.316h35v34h-35z" />
        <path d="M26.148 2.684a5.333 5.333 0 015.333 5.333v13.037a5.334 5.334 0 01-5.333 5.334h-16.11l-5.19 4.296v-5.198a5.328 5.328 0 01-2.367-4.432V8.017a5.333 5.333 0 015.333-5.333h18.334z" />
      </mask>
      <path
        d="M26.148 2.684a5.333 5.333 0 015.333 5.333v13.037a5.334 5.334 0 01-5.333 5.334h-16.11l-5.19 4.296v-5.198a5.328 5.328 0 01-2.367-4.432V8.017a5.333 5.333 0 015.333-5.333h18.334z"
        fill={fillColor}
      />
      <path
        d="M26.148 2.684V.609v2.075zm5.333 5.333h2.075-2.075zm-5.333 18.37v2.075-2.074zm-16.11 0v-2.073c-.484 0-.952.168-1.324.476l1.323 1.598zm-5.19 4.297H2.776A2.074 2.074 0 006.17 32.28L4.85 30.684zm0-5.198h2.075c0-.691-.345-1.337-.92-1.722L4.85 25.486zM2.482 8.016H.407h2.074zm5.333-5.332V.609v2.075zm18.334 0v2.074c1.8 0 3.26 1.459 3.26 3.259h4.148A7.407 7.407 0 0026.149.608v2.075zm5.333 5.333h-2.074v13.037h4.149V8.017H31.48zm0 13.037h-2.074c0 1.8-1.459 3.26-3.259 3.26v4.148a7.408 7.408 0 007.408-7.408H31.48zm-5.333 5.334v-2.074h-16.11v4.148h16.11v-2.074zm-16.11 0L8.713 24.79l-5.188 4.296 1.323 1.598L6.17 32.28l5.189-4.296-1.323-1.597zm-5.19 4.296h2.075v-5.198H2.775v5.198h2.074zm0-5.198l1.156-1.722a3.254 3.254 0 01-1.448-2.71H.407c0 2.568 1.31 4.83 3.286 6.155l1.156-1.723zm-2.367-4.432h2.075V8.017H.407v13.037h2.074zm0-13.037h2.075a3.26 3.26 0 013.259-3.26V.61A7.407 7.407 0 00.406 8.016h2.074zm5.333-5.333v2.074h18.334V.609H7.814v2.075z"
        fill={strokeColor}
        mask="url(#prefix__a)"
      />
      <circle cx={12.407} cy={14.386} r={1.63} fill={strokeColor} stroke={strokeColor} strokeWidth={0.296} />
      <circle cx={21.593} cy={14.386} r={1.63} fill={strokeColor} stroke={strokeColor} strokeWidth={0.296} />
    </svg>
  )
}

const MemoHomepageIcon = React.memo(HomepageIcon)
export default MemoHomepageIcon
