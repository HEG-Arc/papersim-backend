import * as http from 'http';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as sio from 'socket.io';
import * as  fs from 'fs';
import * as path from 'path';
import { Game, GameState, TestGame } from './sim';
import { OdooAdapter } from './odoo_adapter';

let app = express();
let urlencodeParser = bodyParser.urlencoded({ extended: false });
let server = http.createServer(app);
let io = sio().listen(server);
let games:{[key:string]:Game} = {};

const saveFolder:string = 'savegames';

app.use(express.static('public'));
app.get('/', (req: express.Request, res: express.Response) => {
    res.end('papersim server');
});

app.get('/check/:name', (req: express.Request, res: express.Response) => {
  let game = new Game();
  game.start('checker');
  let odooAdapter:OdooAdapter = game.addCompany(req.params.name, {
      database: 'edu-paper2',
      username: 'edu-paper@mailinator.com',
      password: '12345678'
  });
  odooAdapter.updateGameStateAndDay(game);
  odooAdapter.checkConfig().then((result) => {
    res.json(result);
  });
});

function createOrLoadGame(filename?: string): Game {
  console.log('loadGame', filename);
  let game:Game = new Game();
  if (filename) {
    try {
      let json = fs.readFileSync(path.join(saveFolder, filename), 'utf-8');
      game.loadFromJson(json);
    } catch(e) {
      console.log('error loading game', filename, e);
    }
  }
  // forward events to socket.io and setup autosave
  game.pubsub.on('*', (game: Game, ...args:any[]) => {
    save(game);
    io.to(`game-${game.getId()}`).emit((<any> game.pubsub).event, game.getState(), ...args);
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

function gameList ():any[] {
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
  postAuthenticate: function(socket: SocketIO.Socket, data: any){
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
app.listen(80);
