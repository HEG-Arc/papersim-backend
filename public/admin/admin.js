/* global Vue */

(function (exports) {
    'use strict';

    const socket = io.connect('//');

    function prepareItem(item) {
        item.date = new Date(parseInt(item.date));
        if (!item.showDetail) {
            item.showDetail = false;
        }
        if (item.check && typeof item.check === 'string') {
            item.check = JSON.parse(item.check);
        }
        if (item.inspect && typeof item.inspect === 'string') {
            item.inspect = JSON.parse(item.inspect);
        }
        return item;
    }

    exports.app = new Vue({
        el: '#app',
        data: {
            prefix: 'edu-paper-a',
            pattern: '01',
            count: 1,
            newDBS: [],
            DBS: [],
            filter: ''
        },
        created: function () {
            let self = this;
            socket.on('connect', () => {
                socket.emit('authentication', { username: 'test', password: 'root' });
                socket.on('authenticated', () => {
                    // use the socket as usual
                    console.log('connected');
                    socket.on('db_state', (msg) => {
                        console.log('db_state', msg)
                        self.dbData(msg);
                    });
                });
            });
            this.getDBS();

        },
        methods: {
            dbData: function (obj) {
                const self = this;
                function find(name) {
                    for (let i = 0; i < self.DBS.length; i++) {
                        if (self.DBS[i].name === name) {
                            return self.DBS[i];
                        }
                    }
                    return;
                }
                let db = find(obj.name);
                if (db) {
                    Object.keys(obj).forEach((key) => {
                        db[key] = obj[key];
                    });
                } else {
                    db = obj;
                    this.DBS.push(db);
                    this.DBS = this.DBS.sort((a, b) => {
                        return a.name.localeCompare(b.name);
                    });
                }
                prepareItem(db)
            },
            generate: function () {
                this.newDBS = generate(this.prefix, this.pattern, this.count);
                /* todo check  with existing dbs? */
            },
            post: function (event) {
                var self = this;
                fetch('/api/admin/create', {
                    credentials: 'same-origin',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(this.newDBS)
                }).catch(function (ex) {
                    console.log(ex);
                });
                this.newDBS = [];
            },
            getDBS: function (event) {
                var self = this;
                fetch('/api/admin/db', {
                    credentials: 'same-origin'
                })
                    .then(function (response) {
                        return response.json();
                    }).then(function (json) {
                        self.DBS = json.map(prepareItem).sort((a, b) => {
                            return a.name.localeCompare(b.name);
                        });
                    }).catch(function (ex) {
                        console.log('parsing failed', ex);
                    });
            },
            check: function (item) {
                Vue.set(item, 'isChecking', true);
                fetch('/api/check/' + item.name, {
                    credentials: 'same-origin'
                })
                .then(function (response) {
                    Vue.set(item, 'isChecking', false);
                }).catch(function (ex) {
                    Vue.set(item, 'isChecking', false);
                });
            },
            inspect: function (item) {
                Vue.set(item, 'isInspecting', true);
                fetch('/api/inspect/' + item.name, {
                    credentials: 'same-origin'
                })
                .then(function (response) {
                    Vue.set(item, 'isInspecting', false);
                }).catch(function (ex) {
                    Vue.set(item, 'isInspecting', false);
                });
            }
        },

        filters: {
            fromNow: function (date) {
                return moment(date).fromNow();
            },
            date: function (date) {
                return moment(date).format('YYYY-MM-DD, hh:mm:ss');
            },
            countValid: function (l) {
                if (!l) {
                    return 0;
                }
                return l.filter(function (i) {
                    return i.valid;
                }).length;
            }
        }

    });
})(window);