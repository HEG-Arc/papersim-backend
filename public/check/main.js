/* global Vue */

(function (exports) {

    'use strict';
    exports.app = new Vue({
        el: '#app',
        data: {
            result: false,
            isChecking: false,
            progress: 0,
            company: ''
        },
        methods: {
            check: function (event) {
                this.isChecking = true;
                this.result = false;
                this.progress = 0;
                var self = this;
                var interval = setInterval(function(){
                    self.progress = self.progress + 20 % 100;
                }, 50);
                fetch('/check/' + this.company)
                .then(function(response) {
                    return response.json();
                }).then(function(json) {
                    self.result = json;
                    self.isChecking = false;
                    clearInterval(interval);
                }).catch(function(ex) {
                    self.isChecking = false;
                    clearInterval(interval);
                    self.result = [{
                        name: 'Server Error',
                        valid: false
                    }]
                    console.log('parsing failed', ex);

                });
            }
        }
    });
})(window);