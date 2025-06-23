import * as remote from '../packages/remote'
import { CopilotDetail } from '../../shared/types'
import { useAtom, useAtomValue } from 'jotai'
import { languageAtom, myCopilotsAtom } from '../stores/atoms'
import { useQuery } from '@tanstack/react-query'

export function useMyCopilots() {
  const [copilots, setCopilots] = useAtom(myCopilotsAtom)

  const addOrUpdate = (target: CopilotDetail) => {
    setCopilots((copilots) => {
      let found = false
      const newCopilots = copilots.map((c) => {
        if (c.id === target.id) {
          found = true
          return target
        }
        return c
      })
      if (!found) {
        newCopilots.push(target)
      }
      return newCopilots
    })
  }

  const remove = (id: string) => {
    setCopilots((copilots) => copilots.filter((c) => c.id !== id))
  }

  return {
    copilots,
    addOrUpdate,
    remove,
  }
}

export function useRemoteCopilots() {
  const language = useAtomValue(languageAtom)
  const { data: copilots, ...others } = useQuery({
    queryKey: ['remote-copilots', language],
    queryFn: () => remote.listCopilots(language),
    initialData: [],
    initialDataUpdatedAt: 0,
    staleTime: 3600 * 1000,
  })
  return { copilots, ...others }
}
