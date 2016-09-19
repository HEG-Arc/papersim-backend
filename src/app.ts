import * as http from 'http';
import * as sio from 'socket.io';
import * as  fs from 'fs';
import * as path from 'path';
import { Game, GameState, TestGame } from './sim';

let app = http.createServer();
let io = sio().listen(app);
let games:{[key:string]:Game} = {};

const saveFolder:string = 'savegames';


function createOrLoadGame(filename?: string): Game {
  let game:Game = new Game();
  if (filename) {
    try {
      let json = fs.readFileSync(path.join(saveFolder, filename), 'utf-8');
      game.loadFromJson(json);
    } catch(e) {
      console.log(e);
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
        socket.on('addCompany', (id: string, companyName: string) => {
          games[id].addCompany(companyName);
        });

        socket.on('nextState', (id: string) => {
          games[id].next();
        });

        socket.on('input', (id: string, args: any[], callback: Function) => {
          let game = games[id];
          console.log(game);
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

    socket.emit('gameList', gameList());

  }
});

app.listen(80);
