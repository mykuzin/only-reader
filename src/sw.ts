/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'
import { db } from './lib/db'

declare const self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Web Share Target: Android "Share → Only Reader" POSTs the files here.
// They are parked in IndexedDB; the library imports them on load.
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return
  event.respondWith((async () => {
    const form = await event.request.formData()
    const files = form.getAll('books').filter((f): f is File => f instanceof File)
    const d = await db()
    const tx = d.transaction('inbox', 'readwrite')
    for (const file of files) await tx.store.add({ file })
    await tx.done
    return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303)
  })())
})
