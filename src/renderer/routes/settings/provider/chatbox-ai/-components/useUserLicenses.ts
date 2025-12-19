import { useCallback, useEffect, useState } from 'react'
import type { ChatboxAILicenseDetail } from 'src/shared/types'
import { getLicenseDetail, listLicensesByUser, type UserLicense } from '@/packages/remote'
import type { LoginState } from './types'

interface UseUserLicensesParams {
  loginState: LoginState
}

export function useUserLicenses({ loginState }: UseUserLicensesParams) {
  const [licenses, setLicenses] = useState<UserLicense[]>([])
  const [selectedLicenseKey, setSelectedLicenseKey] = useState<string | null>(null)
  const [licenseDetail, setLicenseDetail] = useState<ChatboxAILicenseDetail | null>(null)
  const [loadingLicenses, setLoadingLicenses] = useState(false)
  const [loadingLicenseDetail, setLoadingLicenseDetail] = useState(false)

  // Fetch user licenses when logged in
  useEffect(() => {
    if (loginState === 'success') {
      const fetchLicenses = async () => {
        setLoadingLicenses(true)
        try {
          const userLicenses = await listLicensesByUser()
          setLicenses(userLicenses)

          // Auto-select first license if available
          if (userLicenses.length > 0 && !selectedLicenseKey) {
            setSelectedLicenseKey(userLicenses[0].key)
          }
        } catch (error) {
          console.error('Failed to fetch licenses:', error)
        } finally {
          setLoadingLicenses(false)
        }
      }

      fetchLicenses()
    } else {
      // Reset when logged out
      setLicenses([])
      setSelectedLicenseKey(null)
      setLicenseDetail(null)
    }
  }, [loginState])

  useEffect(() => {
    if (selectedLicenseKey) {
      const fetchLicenseDetail = async () => {
        setLoadingLicenseDetail(true)
        try {
          const detail = await getLicenseDetail({ licenseKey: selectedLicenseKey })
          setLicenseDetail(detail)
        } catch (error) {
          console.error('Failed to fetch license detail:', error)
          setLicenseDetail(null)
        } finally {
          setLoadingLicenseDetail(false)
        }
      }

      fetchLicenseDetail()
    } else {
      setLicenseDetail(null)
    }
  }, [selectedLicenseKey])

  const selectLicense = useCallback((licenseKey: string) => {
    setSelectedLicenseKey(licenseKey)
  }, [])

  return {
    licenses,
    selectedLicenseKey,
    licenseDetail,
    loadingLicenses,
    loadingLicenseDetail,
    selectLicense,
  }
}
