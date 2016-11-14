/* global Vue */

(function (exports) {
    'use strict';

    const socket = io.connect('//localhost');

    function prepareItem(item) {
        item.date = new Date(parseInt(item.date));
        if (!item.showDetail) {
            item.showDetail = false;
        }
        if (item.check) {
            item.check = JSON.parse(item.check);
        }
        if (item.inspect) {
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
            DBS: []
        },
        created: function () {
            let self = this;
            socket.on('connect', () => {
                socket.emit('authentication', { username: 'test', password: 'root' });
                socket.on('authenticated', () => {
                    // use the socket as usual
                    console.log('connected');
                    socket.on('db_state', (msg) => {
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
                fetch('/admin/create', {
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
                fetch('/admin/db')
                    .then(function (response) {
                        return response.json();
                    }).then(function (json) {
                        self.DBS = json.map(prepareItem).sort((a, b) => {
                            return a.name.localeCompare(b.name);
                        });
                    }).catch(function (ex) {
                        console.log('parsing failed', ex);
                    });
            }
        },

        filters: {
            fromNow: function (date) {
                return moment(date).fromNow();
            },
            date: function (date) {
                return moment(date).format('YYYY-MM-DD, hh:mm:ss');
            }
        }

    });
})(window);