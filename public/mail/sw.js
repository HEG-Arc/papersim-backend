self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push Received.');
  const mail = event.data.json();
  const title = 'OdooSim - ' + mail.from;
  const options = {
    body: mail.subject,
    icon: 'images/icon.png',
    badge: 'images/badge.png',
    tag: mail.to,
    data: mail
  };
  event.waitUntil(self.registration.showNotification(title, options));
});


self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification click Received.');

  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});

/* TODO handle subscription change event
self.addEventListener('pushsubscriptionchange', function(event) {
  console.log('[Service Worker]: \'pushsubscriptionchange\' event fired.');
  const applicationServerKey = urlB64ToUint8Array(applicationServerPublicKey);
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey
    })
    .then(function(newSubscription) {
      // TODO: Send to application server
      console.log('[Service Worker] New subscription: ', newSubscription);
    })
  );
});
*/