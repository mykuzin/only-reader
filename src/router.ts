import { useEffect, useState } from 'preact/hooks'

// Hash routing: works on any static host and plays well with Android's back button.

export type Route =
  | { name: 'library' }
  | { name: 'reader'; id: string }
  | { name: 'words' }
  | { name: 'settings' }

const parse = (hash: string): Route => {
  const path = hash.replace(/^#/, '') || '/'
  const read = path.match(/^\/read\/([\w-]+)/)
  if (read) return { name: 'reader', id: read[1] }
  if (path === '/words') return { name: 'words' }
  if (path === '/settings') return { name: 'settings' }
  return { name: 'library' }
}

// How many entries we pushed ourselves, so "back" never leaves the app.
let depth = 0
addEventListener('popstate', () => { depth = Math.max(0, depth - 1) })

export const navigate = (path: string, replace = false) => {
  const url = `#${path}`
  if (replace) history.replaceState(null, '', url)
  else {
    history.pushState(null, '', url)
    depth++
  }
  dispatchEvent(new HashChangeEvent('hashchange'))
}

/** Go back if we came from inside the app, otherwise go to the library. */
export const goBack = () => {
  if (depth > 0) history.back()
  else navigate('/', true)
}

export const useRoute = () => {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash))
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}
