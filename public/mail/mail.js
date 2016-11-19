/* global Vue */
Vue.use(VueRouter);
(function (exports) {

    'use strict';

    var mailApp = Vue.component('mail-app', {
        template: '#mail-app',
        data: function (){
            return {
                name: this.$route.params.name,
                result: [],
                mail: {}
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