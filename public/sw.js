/*
 * Service worker — prepared for Phase 2 push notifications.
 * It deliberately does NOT cache pages or API responses: clinic data must never be
 * served from a device cache (another person could open the phone). Network only.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Staff push messages (src/lib/push). They carry ONLY initials + service + time (lock-screen safe).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "العيادة", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      dir: "auto",
      lang: "ar",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/"; // the dashboard: every staff role may open it
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if ("focus" in c) return c.navigate(url).then(() => c.focus());
      return self.clients.openWindow(url);
    }),
  );
});
