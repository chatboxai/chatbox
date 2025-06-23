import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { e } from 'ofetch/dist/error-04138797'
import { useState } from 'react'

const MAX_HISTORY_LENGTH = 20
const inputBoxHistoryAtom = atomWithStorage<string[]>('input-box-history', [])

const useInputBoxHistory = () => {
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1)
  const [inputBoxHistory, setInputBoxHistory] = useAtom(inputBoxHistoryAtom)

  const addInputBoxHistory = (input: string) => {
    setInputBoxHistory([input, ...inputBoxHistory.filter((h) => h !== input)].slice(0, MAX_HISTORY_LENGTH))
  }

  const clearInputBoxHistory = () => {
    setInputBoxHistory([])
  }

  const getPreviousHistoryInput = () => {
    if (currentHistoryIndex < inputBoxHistory.length - 1) {
      // 如果当前索引小于历史记录长度减1，说明有历史记录可供前进
      const previousIndex = currentHistoryIndex + 1
      setCurrentHistoryIndex(previousIndex)
      return inputBoxHistory[previousIndex]
    }
  }

  const getNextHistoryInput = () => {
    if (currentHistoryIndex > 0) {
      // 如果当前索引大于0，说明有历史记录可供回退
      const nextIndex = currentHistoryIndex - 1
      setCurrentHistoryIndex(nextIndex)
      return inputBoxHistory[nextIndex]
    }
  }

  const resetHistoryIndex = () => {
    setCurrentHistoryIndex(-1)
  }

  return {
    inputBoxHistory,
    addInputBoxHistory,
    clearInputBoxHistory,
    getPreviousHistoryInput,
    getNextHistoryInput,
    resetHistoryIndex,
  }
}

export default useInputBoxHistory
