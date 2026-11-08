const assignmentId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

self.addEventListener('push', (event) => {
  let payload
  try { payload = event.data?.json() } catch { return }
  if (!assignmentId.test(payload?.assignmentId ?? '')) return
  event.waitUntil(self.registration.showNotification('NIGHTWATCH · Field assignment', {
    body: 'You have a new approved assignment. Open NIGHTWATCH Field for details.',
    icon: '/field-192.png',
    tag: 'nightwatch-' + payload.assignmentId,
    data: { assignmentId: payload.assignmentId },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const id = event.notification.data?.assignmentId
  const path = assignmentId.test(id ?? '') ? '/field/assignments/' + id : '/field'
  const target = new URL(path, self.location.origin)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      const current = new URL(client.url)
      if (current.origin !== target.origin || !/^\/field(?:\/|$)/.test(current.pathname)) continue
      try {
        const destination = current.href === target.href ? client : await client.navigate(target.href)
        if (destination) return await destination.focus()
      } catch { /* Open a new window if the existing client cannot navigate. */ }
    }
    return self.clients.openWindow(target.href)
  })())
})
