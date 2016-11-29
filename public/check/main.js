/* global Vue */

(function (exports) {

    'use strict';
    const odooDBnameKey = 'odooDBname';
    exports.app = new Vue({
        el: '#app',
        data: {
            result: false,
            isChecking: false,
            progress: 0,
            company: localStorage.getItem(odooDBnameKey) || '',
            isAdddata: window.location.search.slice(1) === 'adddata'
        },
        methods: {
            _initRequest: function() {
                localStorage.setItem(odooDBnameKey, this.company);
                this.isChecking = true;
                this.result = false;
                this.progress = 0;
                var self = this;
                this.interval = setInterval(function(){
                    Vue.set(self, 'progress', (self.progress + 5) % 100);
                }, 100);
            },
            check: function (event) {
                this._initRequest();
                var self = this;
                fetch('/api/check/' + this.company + '/' + window.location.search.slice(1))
                .then(function(response) {
                    return response.json();
                }).then(function(json) {
                    self.result = json;
                    self.isChecking = false;
                    clearInterval(self.interval);
                }).catch(function(ex) {
                    self.isChecking = false;
                    clearInterval(self.interval);
                    self.result = [{
                        name: 'Server Error',
                        valid: false
                    }]
                    console.log('parsing failed', ex);

                });
            },
            addData: function () {
                this._initRequest();
                var self = this;
                fetch('/api/adddata/' + this.company, {
                    method: 'POST'
                })
                .then(function(response) {
                    if (response.status !== 200) {
                        throw Error(response.status );
                    }
                    self.isChecking = false;
                    clearInterval(self.interval);
                    self.result = [{
                        name: 'Données ajoutées',
                        valid: true
                    }]
                }).catch(function(ex) {
                    self.isChecking = false;
                    clearInterval(self.interval);
                    self.result = [{
                        name: 'Server: ' + ex,
                        valid: false
                    }];
                });
            }
        }
    });
})(window);