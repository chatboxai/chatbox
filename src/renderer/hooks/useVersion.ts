import { useEffect, useState } from 'react'
import platform from '../platform'

export default function useVersion() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    const handler = async () => {
      const v = await platform.getVersion()
      setVersion(v)
    }
    void handler()
  }, [])

  return {
    version,
    versionLoaded: !!version,
  }
}
