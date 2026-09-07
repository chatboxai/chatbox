export type BooleanString = 'true' | 'false'

export function toBooleanString(value: boolean): BooleanString {
  return value ? 'true' : 'false'
}

export function bucketCount(count: number): '0' | '1' | '2_plus' {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  return '2_plus'
}
