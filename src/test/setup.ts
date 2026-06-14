import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom 28 no longer installs window.localStorage, so provide an in-memory
// Storage shim for code (and tests) that read/write it.
if (typeof window !== 'undefined' && !window.localStorage) {
  const createStorage = (): Storage => {
    const store = new Map<string, string>()

    return {
      get length() {
        return store.size
      },
      clear: () => store.clear(),
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key)
      },
      setItem: (key: string, value: string) => {
        store.set(key, String(value))
      },
    }
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: createStorage(),
  })
}

afterEach(() => {
  cleanup()
})
