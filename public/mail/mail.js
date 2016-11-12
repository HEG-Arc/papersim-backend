/* global Vue */

(function (exports) {

    'use strict';
    exports.app = new Vue({
        el: '#app',
        data: {
            name: '',
            result: [],
            view: 'html',
            mail: undefined
        },
        methods: {
            check: function (event) {
                var self = this;
                self.mail = undefined;
                fetch('/mail/' + this.name)
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
            display: function (item) {
                if (item.html) {
                    this.view = 'html';
                } else {
                    this.view = 'text';
                }
                this.mail = item;
            }
        },

        filters: {
            fromNow: function (date) {
                return moment(date).fromNow();
            },
            date: function (date) {
                return moment(date).format('MMMM Do YYYY, hh:mm:ss');
            }
        }

    });
})(window);