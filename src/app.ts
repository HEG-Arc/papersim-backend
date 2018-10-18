import * as http from 'http';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as sio from 'socket.io';
import * as  fs from 'fs';
import * as path from 'path';
import * as redis from 'redis';
import { Game, GameState, TestGame } from './sim';
import { OdooAdapter } from './odoo_adapter';
import { createDB, extrateActivationUrlFromMail, activationUrl2DB, activateDB } from './odoo_sass';
import 'source-map-support/register';

const raven = require("raven");

// env set SENTRY_DSN, SENTRY_ENVIRONMENT
export const ravenClient = new raven.Client();
ravenClient.patchGlobal();
process.on('unhandledRejection', (reason:any, p:Promise<any>) => {
    if(typeof reason === 'object' && reason.hasOwnProperty('data')) {
      ravenClient.captureException(new Error(reason.message), {
          extra: {
              data: reason.data
          }
      });
    } else {
      ravenClient.captureException(reason);
    }
    console.error('unhandledRejection', reason);
});

const webpush = require('web-push');
const app = express();
const urlencodeParser = bodyParser.urlencoded({ extended: false });
const jsonParser = bodyParser.json();
const server = http.createServer(app);
const io = sio()
io.attach(server);
const games: { [key: string]: Game } = {};

const DB_KEY = 'odoosim_db';

const saveFolder: string = 'savegames';

const defaultPassword: string = '12345678';

const redisMailClient = redis.createClient(6379, 'redis_mail');
const redisMailSubClient = redis.createClient(6379, 'redis_mail');
const redisAdminClient = redis.createClient(6379, 'redis_mail');
redisAdminClient.select(1);


function activateDbAndAddUsers(db: string) {
  // get E-mail data or ignore
  redisAdminClient.hmget(db, 'activationURL', 'activationEmail', (err: any, res: any) => {
    if (err) {
      console.log('[activation]', err);
      return;
    }
    const url = res[0];
    const to = res[1];
    activateDB(url, defaultPassword).then((db) => {
      updateDBState(db, 'activated', 'email', to, 'password', defaultPassword);
        prepareAdapterForDB(db).then((odooAdapter) => {
          /* todo promise */
          odooAdapter.createUser('VPSales', defaultPassword).then(() => {
            odooAdapter.inspect().then((result) => {
              updateDB(db, 'inspect', JSON.stringify(result));
              odooAdapter.updateNames();
            });
          });
        });
    });
  });
}

redisAdminClient.on("error", function (err: any) {
  console.log("RedisAdminClientError " + err);
});
/* Handle e-mail events */
redisMailSubClient.on('psubscribe', (pattern: any, count: any) => {
  console.log("subscribed to ", pattern, count)
});
redisMailSubClient.on("pmessage", (pattern: any, event: any, value: any) => {
  //config set notify-keyspace-events Es$
  console.log('pmessage', pattern, event, value)
  redisMailClient.get(value, (err: any, text: any) => {
    if (err) {
      console.log('redis error', err);
    }
    let mail: any = JSON.parse(text);
    console.log('[new mail]', mail.date, mail.to, mail.from, mail.subject);
    notifyNewMail(mail);

    if (mail.subject.indexOf('Activate') > -1 && mail.subject.indexOf('odoo.com') > -1) {
      /* TODO error handling */
      console.log('Odoo mail detected!');
      const url = extrateActivationUrlFromMail(mail.text);
      const dbName = activationUrl2DB(url);
      console.log(dbName, url);
      updateDB(dbName, 'activationURL', url, 'activationEmail', mail.to);

      // always activate DB
      activateDbAndAddUsers(dbName);
      /*
      // if db already created activate
      redisAdminClient.hmget(dbName, 'state', (err: any, res: any) => {
        if (err) {
          console.log('[email direct activation]', err);
        }
        if (res[0] === 'created') {

        }
      });
      */
    }
  });
});

redisMailSubClient.psubscribe('__keyevent@0__:set');

/* Web API */

import * as passport from 'passport';
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';

// The request handler must be the first item
app.use(raven.middleware.express.requestHandler(ravenClient));
app.use(cookieParser());
app.use(session({secret: process.env.SESSION_SECRET || 'dev',
  resave: false,
  saveUninitialized: false}));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromBodyField('jwt'),
  secretOrKey: process.env.JWT_SECRET
}, (jwtPayload, done) => {
  if((process.env.ADMINS || '').split(',').indexOf(jwtPayload.email) > -1) {
    done(null, jwtPayload);
  } else {
    done(null, false);
  }
}));

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) {
      next();
    } else {
      (<any> req.session).returnTo = req.originalUrl;
      res.redirect(`https://marmix.ig.he-arc.ch/shibjwt/?reply_to=${process.env.HOST_URL || 'http://localhost'}/token`);
    }
}

app.use('/admin', requireAdmin);
app.use(express.static('public'));


// mail html5 mode
app.get('/mail/*', function(req, res) {
  res.sendFile(path.join(__dirname, '../public/mail/index.html'));
});

/* Web Push*/
const vapidKeysFilename = 'data/vapidKeys.json';
let vapidKeys:any;
try {
  vapidKeys = JSON.parse(fs.readFileSync(vapidKeysFilename, 'utf-8'));
} catch(e) {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidKeysFilename, JSON.stringify(vapidKeys));
}
webpush.setVapidDetails(
  'mailto:boris.fritscher@gmail.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const subscriptionsFilename = 'data/subscriptions.json';
let subscriptions:any;
try {
  subscriptions = JSON.parse(fs.readFileSync(subscriptionsFilename, 'utf-8'));
} catch(e) {
  subscriptions = {};
}

app.post('/token', urlencodeParser, passport.authenticate('jwt', {
  successReturnToOrRedirect: '/admin',
  failureRedirect: '/'
}));

app.get('/secure', requireAdmin, (req: express.Request, res: express.Response) => {
  res.send(req.user);
});

app.get('/api/push/key', (req: express.Request, res: express.Response) => {
  res.send(vapidKeys.publicKey);
});

app.post('/api/push/subscribe', jsonParser, (req: express.Request, res: express.Response) => {
  const mail = `${req.body.name}@odoosim.ch`;
  const endpoint = req.body.endpoint;
  const subscription = req.body.subscription;
  if(!subscriptions.hasOwnProperty(mail)){
    subscriptions[mail] = {};
  }
  if (subscription) {
    subscriptions[mail][endpoint] = subscription;
  } else {
    delete subscriptions[mail][endpoint];
  }
  fs.writeFileSync(subscriptionsFilename, JSON.stringify(subscriptions));
  res.end();
});

function notifyNewMail(mail:any){
  if(subscriptions.hasOwnProperty(mail.to)){
    Object.keys(subscriptions[mail.to]).forEach((endpoint) => {
      webpush.sendNotification(
      subscriptions[mail.to][endpoint],
      JSON.stringify({
        to: mail.to,
        from: mail.from,
        subject: mail.subject,
        url: '/mail/' + mail.to.split('@')[0] +'/0'
      }),
      {
        TTL: 3600
      });
    });
  }
}

/* Odoo checks */

function prepareAdapterForDB(name: string): Promise<OdooAdapter> {
  return new Promise((resolve: (value: any) => void, reject: (value: any) => void) => {
    let game = new Game();
    game.start('checker');
    redisAdminClient.hmget(name, 'email', 'password', (err: any, res: any) => {
      if (err) {
        reject(err);
      } else {
        let odooAdapter: OdooAdapter = game.addCompany(name, {
          database: name,
          username: res[0],
          password: res[1]
        });
        if (odooAdapter) {
          odooAdapter.updateGameStateAndDay(game);
          resolve(odooAdapter);
        } else {
          return reject('no account found');
        }
      }
    });
  });
}

app.get('/api/check/:name/:type?', (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.name).then((odooAdapter) => {
    console.log(req.params.name, req.params.type);
    let f:Function = odooAdapter.checkConfig;
    switch(req.params.type) {
      case 'suppliers':
        f = odooAdapter.checkSuppliers;
        break;
      case 'customers':
        f = odooAdapter.checkCustomers;
        break;
      case 'uoms':
        f = odooAdapter.checkUoMs;
        break;
      case 'supplyproducts':
        f = odooAdapter.checkSupplyProducts;
        break;
      case 'marketproducts':
        f = odooAdapter.checkMarketProducts;
        break;
      case 'boms':
        f = odooAdapter.checkBOMs;
        break;
    }
    return f.call(odooAdapter).then((result: any) => {
      //TODO: object assign so that partial check do not overwrite
      updateDB(req.params.name, 'check', JSON.stringify(result))
      res.json(result);
    });
  }).catch((err) => {
    res.sendStatus(404);
  });
});

app.get('/api/inspect/:name', (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.name).then((odooAdapter) => {
    odooAdapter.inspect().then((result) => {
      updateDB(req.params.name, 'inspect', JSON.stringify(result))
      res.json(result);
    });
  })
});

app.post('/api/adddata/:name', (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.name).then((odooAdapter) => {
      return odooAdapter.addQuizData().then(()=>{
        res.sendStatus(200);
      }).catch(() => {
        res.sendStatus(500);
      });
  }).catch(() => {
    res.sendStatus(404);
  });
});


app.get('/api/updatename/:name', (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.name).then((odooAdapter) => {
    /* todo promise */
    odooAdapter.updateNames();
    res.end();
  })
});

app.get('/api/adduser/:dbname/:user', (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.dbname).then((odooAdapter) => {
    odooAdapter.createUser(req.params.user, defaultPassword).then(()=>{
      odooAdapter.inspect().then((result) => {
        updateDB(req.params.dbname, 'inspect', JSON.stringify(result));
      });
    });
  });
  res.end();
});

/* helper to scan redis (could try streaming version) */
function fullscan(client: redis.RedisClient, pattern: string, callback: (err: any, results: any) => void) {
  let results: any[] = [];
  function scan(cursor: number) {
    client.scan(cursor, 'match', pattern, (err: any, replies: any) => {
      if (err) {
        callback(err, null);
      } else {
        cursor = parseInt(replies[0]);
        results = results.concat(replies[1]);
        if (cursor === 0) {
          callback(null, results);
        } else {
          scan(cursor)
        }
      }
    });
  }
  scan(0);
}

app.get('/api/mail/:name/list', (req: express.Request, res: express.Response) => {
  // TODO protect private mails?
  fullscan(redisMailClient, `${req.params.name}@odoosim.ch:*`, (err: any, results: any) => {
    if (err) {
      res.status(500).send(err);
    } else if (results.length === 0) {
      res.json([]);
    } else {
      redisMailClient.mget(results, (err: any, results: any) => {
        res.send(`[${results.join(',')}]`);
      });
    }
  });
});

app.get('/api/mail/:name/send', (req: express.Request, res: express.Response) => {
  const mail = {
    to: `${req.params.name}@odoosim.ch`,
    from: 'random@example.com',
    subject: 'Test email',
    text: 'Hello World\nLine 2',
    html: '<h1>Hello world</h1>',
    raw: 'fake',
    hash: new Date().getTime(),
    recipient: `${req.params.name}@odoosim.ch`,
    address: `${req.params.name}@odoosim.ch`,
    mailFrom: 'random@example.com',
    tls: false,
    date: new Date()
  };
  redisMailClient.setex(`${req.params.name}@odoosim.ch:${mail.hash}`, 3600, JSON.stringify(mail), (err: any, results: any) => {
    if (err) {
      res.status(500).send(err);
    } else {
      res.end(results);
    }
  });
});


// TODO: secure

function updateDB(name: string, ...args: any[]) {
  const msg: any = {
    name: name,
    date: new Date().getTime()
  };
  for (let i = 0; i < args.length; i = i + 2) {
    msg[args[i]] = args[i + 1];
  }
  redisAdminClient.hmset(name, 'name', name, 'date', new Date().getTime(), ...args);
  io.to('admin').emit('db_state', msg);
}

function updateDBState(name: string, state: string, ...args: any[]) {
  updateDB(name, 'state', state, ...args);
}

app.get('/api/createconfig/:name', requireAdmin, (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.name).then((odooAdapter) => {
    /* todo promise */
    odooAdapter.createConfig();
    res.end();
  })
});

app.get('/api/admin/db', requireAdmin, (req: express.Request, res: express.Response) => {
  redisAdminClient.smembers(DB_KEY, (err: any, response: any) => {
    redisAdminClient.multi(response.map((key: string) => {
      return ['hgetall', key];
    })).exec((err: any, response: any) => {
      res.json(response);
    });
  });
});

app.post('/api/admin/create', requireAdmin, jsonParser, (req: express.Request, res: express.Response) => {
  // get from post
  req.body.forEach((name: string) => {
    name = name.toLowerCase();
    if (name === DB_KEY) {
      return;
    }
    // add to redis set
    redisAdminClient.sadd(DB_KEY, name);
    /* TODO check if exists? */
    // add own key with status creating, date
    const email = `admin.${name}@odoosim.ch`;
    updateDBState(name, 'creating', 'email', email);
    createDB(name, email).then((db) => {
      // update redis
      updateDBState(db, 'created');
      if (db !== name) {
        redisAdminClient.sadd(DB_KEY, db);
        updateDBState(name, 'renamed', 'to', db);
      }
      activateDbAndAddUsers(db);
    }, () => {
      updateDBState(name, 'failed');
    });

  });
  res.end();
});

app.get('/api/admin/test/create', requireAdmin, (req: express.Request, res: express.Response) => {
  const name = 'edu-paper2';
  redisAdminClient.sadd(DB_KEY, name);
  const email = `edu-paper@mailinator.com`;
  updateDBState(name, 'activated', 'email', email, 'password', defaultPassword);
  res.end();
});

app.get('/api/admin/c2c/:email/:password', requireAdmin, (req: express.Request, res: express.Response) => {
 ['edu-p18-c01a',
  'edu-p18-c01b',
  'edu-p18-c02a',
  'edu-p18-c02b',
  'edu-p18-c03a',
  'edu-p18-c03b',
  'edu-p18-c04a',
  'edu-p18-c04b',
  'edu-p18-c05a',
  'edu-p18-c05b',
  'edu-p18-c06a',
  'edu-p18-c06b',
  'edu-p18-d01a',
  'edu-p18-d01b',
  'edu-p18-d02a',
  'edu-p18-d02b',
  'edu-p18-d03a',
  'edu-p18-d03b',
  'edu-p18-d04a',
  'edu-p18-d04b',
  'edu-p18-d05a',
  'edu-p18-d05b',
  'edu-p18-d06a',
  'edu-p18-d06b',
  'edu-p18-f01a',
  'edu-p18-f01b',
  'edu-p18-f02a',
  'edu-p18-f02b',
  'edu-p18-f03a',
  'edu-p18-f03b',
  'edu-p18-f04a',
  'edu-p18-f04b',
  'edu-p18-f05a',
  'edu-p18-f05b',
  'edu-p18-r01a',
  'edu-p18-r01b',
  'edu-p18-r02a',
  'edu-p18-r02b',
  'edu-p18-r03a',
  'edu-p18-r03b',
  'edu-p18-r04a',
  'edu-p18-r04b',
  'edu-p18-r05a',
  'edu-p18-r05b',
  'edu-p18-r06a',
  'edu-p18-r06b',
  'edu-paper-pa',
  'edu-paper-pb',
  'edu-paper-pc'].forEach((name) => {
    redisAdminClient.sadd(DB_KEY, name);
    updateDBState(name, 'activated', 'email', req.params.email, 'password', req.params.password);
  })

  res.end();
});

app.get('/api/admin/activate/:dbname', requireAdmin, (req: express.Request, res: express.Response) => {
  activateDbAndAddUsers(req.params.dbname);
  res.end();
});


function onError(err:any, req: express.Request, res: any, next:any) {
    // The error id is attached to `res.sentry` to be returned
    // and optionally displayed to the user for support.
    res.statusCode = 500;
    res.end(err + '\nSentry error id: ' + res.sentry+'\n');
}

// The error handler must be before any other error middleware
app.use(raven.middleware.express.errorHandler(ravenClient));

// Optional fallthrough error handler
app.use(onError);



/* TODO delete */

/*  Game stuff move? */

function createOrLoadGame(filename?: string): Game {
  console.log('loadGame', filename);
  let game: Game = new Game();
  if (filename) {
    try {
      let json = fs.readFileSync(path.join(saveFolder, filename), 'utf-8');
      game.loadFromJson(json);
    } catch (e) {
      console.log('error loading game', filename, e);
    }
  }
  // forward events to socket.io and setup autosave
  game.pubsub.on('*', (game: Game, ...args: any[]) => {
    save(game);
    io.to(`game-${game.getId()}`).emit((<any>game.pubsub).event, game.getState(), ...args);
  });
  games[game.getId()] = game;
  return game;
}

// load games
// TODO: do not load everything....
if (!fs.existsSync(saveFolder)) {
  fs.mkdirSync(saveFolder);
}
fs.readdirSync('savegames').forEach(createOrLoadGame);


function save(game: Game) {
  fs.writeFileSync(path.join(saveFolder, `${game.getId()}.json`), game.toJson());
}

// odooAdapter <-> web?

function gameList(): any[] {
  return Object.keys(games).map((id) => {
    return games[id].getState();
  });
}

require('socketio-auth')(io, {
  authenticate: function (socket: SocketIO.Socket, data: any, callback: Function) {
    //get credentials sent by the client
    console.log('socket auth');
    var username = data.username;
    var password = data.password;

    if (username) {
      return callback(null, password === 'root');
    } else {
      return callback(new Error('User not found'));
    }
  },
  postAuthenticate: function (socket: SocketIO.Socket, data: any) {

    socket.join('admin');


    socket.on('joinGame', (id: string, callback: Function) => {
      let game = games[id];
      if (game) {
        // TODO FIX should be relative to current game not allow any game id
        socket.on('addCompany', (id: string, companyName: string, odoo?: any) => {
          games[id].addCompany(companyName, odoo);
        });

        socket.on('nextState', (id: string) => {
          games[id].next();
        });

        socket.on('input', (id: string, args: any[], callback: Function) => {
          let game = games[id];
          console.log('app.input', game);
          let r = false;
          if (game.input) {
            r = game.input.apply(game, args);
          }
          if (callback) {
            callback(r);
          }
        });

        socket.on('leaveGame', (id: string) => {
          socket.leave(`game-${id}`);
        });

        socket.on('editedGame', (gameState: GameState) => {
          let game = games[gameState.id];
          game.loadFromJson(JSON.stringify(gameState));
          save(game);
        });

        socket.on('simulateGame', () => {
          new TestGame(game).start();
        });

        socket.join(`game-${id}`);
        callback(game.getState());
      }
    });

    socket.on('createGame', (name: string, callback: Function) => {
      let game = createOrLoadGame();
      game.start(name);
      save(game);
      callback(game.getId());
      io.emit('gameList', gameList());
    });
    console.log('post auth');
    socket.emit('gameList', gameList());

  }
});
console.log('listenning for connections');
server.listen(80);
