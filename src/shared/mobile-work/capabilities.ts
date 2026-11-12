export const LOCAL_WORK_CAPABILITY_IDS = ['photos', 'calendar', 'reminders', 'health'] as const

export type LocalWorkCapabilityId = (typeof LOCAL_WORK_CAPABILITY_IDS)[number]

export const DEFAULT_LOCAL_WORK_CAPABILITIES: readonly LocalWorkCapabilityId[] = []

export function resolveLocalWorkCapabilities(value?: readonly LocalWorkCapabilityId[]): LocalWorkCapabilityId[] {
  const enabled = new Set(value ?? DEFAULT_LOCAL_WORK_CAPABILITIES)
  return LOCAL_WORK_CAPABILITY_IDS.filter((id) => enabled.has(id))
}

export function setLocalWorkCapability(
  value: readonly LocalWorkCapabilityId[] | undefined,
  id: LocalWorkCapabilityId,
  enabled: boolean
): LocalWorkCapabilityId[] {
  const selected = new Set(resolveLocalWorkCapabilities(value))
  if (enabled) selected.add(id)
  else selected.delete(id)
  return resolveLocalWorkCapabilities([...selected])
}
