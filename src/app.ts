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

let app = express();
let urlencodeParser = bodyParser.urlencoded({ extended: false });
let jsonParser = bodyParser.json();
let server = http.createServer(app);
let io = sio()
io.attach(server);
let games: { [key: string]: Game } = {};

const DB_KEY = 'odoosim_db';

const saveFolder: string = 'savegames';

const defaultPassword: string = '12345678';

let redisMailClient = redis.createClient(6379, 'redis_mail');
let redisMailSubClient = redis.createClient(6379, 'redis_mail');
let redisAdminClient = redis.createClient(6379, 'redis_mail');
redisAdminClient.select(1);

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
    console.log("new mail", mail.to, mail.from, mail.subject, mail.text);
    if (mail.subject.indexOf('Activate') > -1 && mail.subject.indexOf('odoo.com') > -1) {
      /* TODO error handling */
      const url = extrateActivationUrlFromMail(mail.text);
      const dbName = activationUrl2DB(url);
      updateDBState(dbName, 'email');
      activateDB(url, defaultPassword).then((db) => {
        updateDBState(db, 'activated', 'email', mail.to, 'password', defaultPassword);
         prepareAdapterForDB(db).then((odooAdapter) => {
            /* todo promise */
            odooAdapter.createUser('VPSales', defaultPassword).then(() => {
              odooAdapter.inspect().then((result) => {
                updateDB(db, 'inspect', JSON.stringify(result));
              });
            });
            // TODO error if no warehouse...
            odooAdapter.updateNames();
          });
      });
    }
  });
});

redisMailSubClient.psubscribe('__keyevent@0__:set');

/* Web API */

app.use(express.static('public'));

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
        odooAdapter.updateGameStateAndDay(game);
        resolve(odooAdapter);
      }
    });
  });
}

app.get('/check/:name', (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.name).then((odooAdapter) => {
    odooAdapter.checkConfig().then((result) => {
      updateDB(req.params.name, 'check', JSON.stringify(result))
      res.json(result);
    });
  })
});

app.get('/inspect/:name', (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.name).then((odooAdapter) => {
    odooAdapter.inspect().then((result) => {
      updateDB(req.params.name, 'inspect', JSON.stringify(result))
      res.json(result);
    });
  })
});

app.get('/update/:name', (req: express.Request, res: express.Response) => {
  prepareAdapterForDB(req.params.name).then((odooAdapter) => {
    /* todo promise */
    odooAdapter.updateNames();
    res.end();
  })
});

app.get('/adduser/:dbname/:user', (req: express.Request, res: express.Response) => {
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
        console.log(cursor);
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


app.get('/mail/:name', (req: express.Request, res: express.Response) => {
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

// TODO: secure

function updateNameOdoo(name: string) {
  prepareAdapterForDB(name).then((odooAdapter) => {

  });
}

function updateDB(name: string, ...args: any[]) {
  const msg: any = {
    name: name,
    date: new Date().getTime()
  };
  for (let i = 0; i < args.length; i = i + 2) {
    msg[args[i]] = args[i + 1];
  }
  console.log(msg);
  redisAdminClient.hmset(name, 'name', name, 'date', new Date().getTime(), ...args);
  io.to('admin').emit('db_state', msg);
}

function updateDBState(name: string, state: string, ...args: any[]) {
  updateDB(name, 'state', state, ...args);
}

app.get('/admin/db', (req: express.Request, res: express.Response) => {
  redisAdminClient.smembers(DB_KEY, (err: any, response: any) => {
    redisAdminClient.multi(response.map((key: string) => {
      return ['hgetall', key];
    })).exec((err: any, response: any) => {
      res.json(response);
    });
  });
});

app.post('/admin/create', jsonParser, (req: express.Request, res: express.Response) => {
  // get from post
  req.body.forEach((name: string) => {
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
        updateDBState(name, 'renamed', 'to', db);
      }
    });

  });
  res.end();
});

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
