/* global Vue */


// push notification test
var swRegistration;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

if ('serviceWorker' in navigator && 'PushManager' in window) {
  console.log('Service Worker and Push is supported');

  navigator.serviceWorker.register('sw.js')
  .then(function(swReg) {
    console.log('Service Worker is registered', swReg);

    swRegistration = swReg;
  })
  .catch(function(error) {
    console.error('Service Worker Error', error);
  });
} else {
  console.warn('Push messaging is not supported');
}

function checkSubscription() {
  return swRegistration.pushManager.getSubscription();
}

function subscribeUser() {
  return fetch('/api/push/key')
  .then(function(response){
      return response.text();
  }).then(function(applicationServerPublicKey){
    const applicationServerKey = urlBase64ToUint8Array(applicationServerPublicKey);
    return swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
    })
    .then(function(subscription) {
        console.log('User is subscribed:', subscription);
        return subscription;
    })
    .catch(function(err) {
        console.log('Failed to subscribe the user: ', err);
    });
  });
}

function unsubscribeUser() {
  return swRegistration.pushManager.getSubscription()
  .then(function(subscription) {
    if (subscription) {
      return subscription.unsubscribe();
    }
  })
  .catch(function(error) {
    console.log('Error unsubscribing', error);
  })
  .then(function() {
    console.log('User is unsubscribed.');
  });
}

function updateSubscriptionOnServer(endpoint, name, subscription) {
    return fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            endpoint: endpoint,
            name: name,
            subscription: subscription
        })
    }).catch(function (ex) {
        console.log(ex);
    });
}
// vue.js

Vue.use(VueRouter);
(function (exports) {

    'use strict';

    var mailApp = Vue.component('mail-app', {
        template: '#mail-app',
        data: function (){
            return {
                name: this.$route.params.name,
                result: [],
                mail: {},
                alerts: JSON.parse(localStorage.getItem('alerts') || '{}')
            };
        },
        watch: {
            '$route' (to, from) {
                this.name = to.params.name;
                this.fetchMail();
            }
        },
        created: function () {
            if (this.name) {
                this.fetchMail();
            }
        },
        methods: {
            check: function () {
                if (this.$route.params.name !== this.name) {
                    router.push({ name: 'mail-list', params: { name: this.name }});
                } else {
                    this.fetchMail();
                }
            },
            fetchMail: function () {
                var self = this;
                self.mail = undefined;
                fetch('/api/mail/' + this.name + '/list')
                .then(function(response) {
                    return response.json();
                }).then(function(json) {
                    self.result = json.map(function(mail) {
                        mail.date = new Date(mail.date);
                        return mail;
                    }).sort(function(a, b){
                        return b.date - a.date;
                    })
                }).catch(function(ex) {
                    self.result = [{
                        name: 'Server Error',
                        valid: false
                    }]
                    console.log('parsing failed', ex);
                });
            },
            subscribe: function(name) {
                const self = this;
                const subscribeWhenReady =  function (subscription){
                    if (subscription) {
                        updateSubscriptionOnServer(subscription.endpoint, name, subscription).then(function(){
                            Vue.set(self.alerts, name, subscription.endpoint);
                            localStorage.setItem('alerts', JSON.stringify(self.alerts));
                        });
                    } else {
                        subscribeUser().then(subscribeWhenReady);
                    }
                };
                checkSubscription().then(subscribeWhenReady);
            },
            unsubscribe: function(name){
                const self = this;
                updateSubscriptionOnServer(self.alerts[name], name).then(function(){
                    Vue.delete(self.alerts, name);
                    localStorage.setItem('alerts', JSON.stringify(self.alerts));
                    if (Object.keys(self.alerts).length === 0) {
                        unsubscribeUser();
                    }
                });
            }
        }
    });

    var mailList = Vue.component('mail-list', {
        template: '#mail-list-template',
        props: ['result'],
    });

    var mailDetail = Vue.component('mail-detail', {
        template: '#mail-detail-template',
        props: ['result'],
        data : function () {
            var mail = this.result[this.$route.params.index];
            return {
                mail: mail,
                index: parseInt(this.$route.params.index),
                view: mail && mail.html ? 'html' : 'text'
            }
        },
        watch: {
            '$route': function (to, from) {
                this.mail = this.result[to.params.index];
                this.index = parseInt(to.params.index),
                this.view = this.mail.html ? 'html' : 'text'
            },
            'result': function () {
                this.mail = this.result[this.$route.params.index];
                this.index = parseInt(this.$route.params.index),
                this.view = this.mail.html ? 'html' : 'text'
            }
        },
    });

    Vue.filter('fromNow', function (date) {
        return moment(date).fromNow();
    });

    Vue.filter('date', function (date) {
        return moment(date).format('MMMM Do YYYY, hh:mm:ss');
    });

    var router = new VueRouter({
        mode: 'history',
        routes: [
            {path: '/', component: mailApp},
            {path: '/:name', component: mailApp,
             children: [
                 {path:'', name:'mail-list', component: mailList},
                 {path:':index', name:'mail-detail', component: mailDetail}

            ]}
        ]
    });

    exports.app = new Vue({
        el: '#app',
        router: router
    });
})(window);