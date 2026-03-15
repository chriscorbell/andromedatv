import { useEffect, useRef, useState } from 'react'

export function useAboutModal() {
  const [infoVisible, setInfoVisible] = useState(false)
  const [infoActive, setInfoActive] = useState(false)
  const infoCloseTimeoutRef = useRef<number | null>(null)

  const openInfo = () => {
    if (infoCloseTimeoutRef.current) {
      window.clearTimeout(infoCloseTimeoutRef.current)
      infoCloseTimeoutRef.current = null
    }

    setInfoVisible(true)
    setInfoActive(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setInfoActive(true)
      })
    })
  }

  const closeInfo = () => {
    setInfoActive(false)
    if (infoCloseTimeoutRef.current) {
      window.clearTimeout(infoCloseTimeoutRef.current)
    }
    infoCloseTimeoutRef.current = window.setTimeout(() => {
      setInfoVisible(false)
    }, 220)
  }

  useEffect(() => {
    if (!infoVisible) {
      return
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeInfo()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [infoVisible])

  useEffect(() => {
    return () => {
      if (infoCloseTimeoutRef.current) {
        window.clearTimeout(infoCloseTimeoutRef.current)
      }
    }
  }, [])

  return {
    closeInfo,
    infoActive,
    infoVisible,
    openInfo,
  }
}
