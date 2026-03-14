import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hasAttribute('disabled'))
}

export function useDialogFocus<T extends HTMLElement>(
  active: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const containerRef = useRef<T | null>(null)

  useEffect(() => {
    if (!active || !containerRef.current) {
      return
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const container = containerRef.current
    const focusableElements = getFocusableElements(container)
    const fallbackFocusTarget = focusableElements[0]
    const nextFocusTarget =
      initialFocusRef?.current || fallbackFocusTarget || container

    nextFocusTarget.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return
      }

      const orderedFocusableElements = getFocusableElements(container)
      if (orderedFocusableElements.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }

      const firstElement = orderedFocusableElements[0]
      const lastElement = orderedFocusableElements.at(-1)
      if (!firstElement || !lastElement) {
        return
      }

      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
        return
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      previousActiveElement?.focus()
    }
  }, [active, initialFocusRef])

  return containerRef
}
