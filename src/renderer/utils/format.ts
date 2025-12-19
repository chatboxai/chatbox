// 格式化数字为简短形式 (例如: 12000000 -> 12m, 210000 -> 210k, 191 -> 191)
export const formatNumber = (num: number, decimals: number = 0): string => {
  if (num >= 1000000) {
    return decimals > 0 ? `${(num / 1000000).toFixed(decimals)}M` : `${Math.floor(num / 1000000)}M`
  } else if (num >= 1000) {
    return decimals > 0 ? `${(num / 1000).toFixed(decimals)}K` : `${Math.floor(num / 1000)}K`
  }
  return decimals > 0 ? num.toFixed(decimals) : num.toString()
}

// 格式化使用量显示 (例如: "210k/12m" 或 "191/200")
export const formatUsage = (used: number, total: number, decimals: number = 0): string => {
  return `${formatNumber(used, decimals)}/${formatNumber(total, decimals)}`
}
