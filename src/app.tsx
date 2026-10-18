import { useRoute } from './router'
import { Library } from './library/Library'
import { Reader } from './reader/Reader'
import { SettingsPage } from './settings/SettingsPage'
import { Words } from './words/Words'

export const App = () => {
  const route = useRoute()
  switch (route.name) {
    case 'reader': return <Reader key={route.id} id={route.id} />
    case 'words': return <Words />
    case 'settings': return <SettingsPage />
    default: return <Library />
  }
}
