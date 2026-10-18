import { render } from 'preact'
import '@fontsource-variable/literata/wght.css'
import './styles.css'
import { App } from './app'
import { applyTheme } from './lib/settings'
import { enqueueFiles } from './library/Library'
import { navigate } from './router'

applyTheme()

// Desktop "Open with → Only Reader" (File Handling API).
type LaunchParams = { files: FileSystemFileHandle[] }
const launchQueue = (window as unknown as {
  launchQueue?: { setConsumer: (cb: (p: LaunchParams) => void) => void }
}).launchQueue
launchQueue?.setConsumer(async ({ files }) => {
  if (!files?.length) return
  enqueueFiles(await Promise.all(files.map(f => f.getFile())))
  if (location.hash.length > 2) navigate('/', true)
})

// Arrived from the share sheet: files are waiting in the inbox.
if (new URLSearchParams(location.search).has('shared')) {
  history.replaceState(null, '', location.pathname + '#/')
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
}

render(<App />, document.getElementById('app')!)
