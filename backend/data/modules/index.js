// Tic-Tac-Toe Match Handler for Nakama
// OpCodes: 1=move, 2=state update, 3=rematch

var TICK_RATE = 2;
var TIMED_MODE_TICKS = 30 * TICK_RATE;

var WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

var activeTickets = {};

function createInitialState(mode) {
  return {
    board: ["", "", "", "", "", "", "", "", ""],
    players: [null, null],
    usernames: [null, null],
    turn: 0,
    status: "waiting",
    mode: mode,
    winner: null,
    winningLine: null,
    moveCount: 0,
    lastActivity: Date.now(),
    deadlineTick: 0,
    deadlineStartTick: 0,
    gameStarted: false,
    pendingLeaves: []
  };
}

function checkWin(board) {
  for (var i = 0; i < WINNING_LINES.length; i++) {
    var line = WINNING_LINES[i];
    var a = line[0], b = line[1], c = line[2];
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a] === "X" ? 0 : 1, winningLine: line };
    }
  }
  return { winner: null, winningLine: null };
}

function isBoardFull(board) {
  for (var j = 0; j < board.length; j++) {
    if (board[j] === "") return false;
  }
  return true;
}

function decodeMessage(data) {
  if (!data) return null;
  try {
    if (typeof data === 'string') {
      if (data.length === 0) return null;
      return JSON.parse(data);
    }
    var bytes = new Uint8Array(data);
    if (bytes.length === 0) return null;
    var jsonString = String.fromCharCode.apply(null, bytes);
    return JSON.parse(jsonString);
  } catch (e) {
    return null;
  }
}

function encodeState(state) {
  return JSON.stringify(state);
}

function updateStats(nk, userId, username, result) {
  var collection = "player_stats";
  var key = userId;
  var stats;

  try {
    var resultRead = nk.storageRead([
      { collection: collection, key: key, userId: "00000000-0000-0000-0000-000000000000" }
    ]);
    if (resultRead && resultRead.length > 0) {
      stats = resultRead[0].value;
    } else {
      stats = { user_id: userId, username: username, wins: 0, losses: 0, draws: 0, win_streak: 0, best_streak: 0, last_result: "none" };
    }
  } catch (e) {
    stats = { user_id: userId, username: username, wins: 0, losses: 0, draws: 0, win_streak: 0, best_streak: 0, last_result: "none" };
  }

  stats.last_result = result;
  if (result === "win") {
    stats.wins = (stats.wins || 0) + 1;
    stats.win_streak = (stats.win_streak || 0) + 1;
    if ((stats.win_streak || 0) > (stats.best_streak || 0)) {
      stats.best_streak = stats.win_streak;
    }
  } else if (result === "loss") {
    stats.losses = (stats.losses || 0) + 1;
    stats.win_streak = 0;
  } else {
    stats.draws = (stats.draws || 0) + 1;
  }

  try {
    nk.storageWrite([{ collection: collection, key: key, userId: undefined, value: stats, permissionRead: 2, permissionWrite: 0 }]);
  } catch (e) {}
}

function getLeaderboardData(nk, limit) {
  var allStats = [];
  try {
    var list = nk.storageList("00000000-0000-0000-0000-000000000000", "player_stats", 100);
    if (list && list.length > 0) {
      var reads = [];
      for (var mi = 0; mi < list.length; mi++) {
        reads.push({ collection: "player_stats", key: list[mi].Key, userId: "00000000-0000-0000-0000-000000000000" });
      }
      if (reads.length > 0) {
        var results = nk.storageRead(reads);
        for (var ri = 0; ri < results.length; ri++) {
          if (results[ri] && results[ri].value) {
            allStats.push(results[ri].value);
          }
        }
      }
    }
  } catch (e) {}

  allStats.sort(function(a, b) {
    var scoreA = (a.wins || 0) - (a.losses || 0);
    var scoreB = (b.wins || 0) - (b.losses || 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    if ((a.win_streak || 0) !== (b.win_streak || 0)) return (b.win_streak || 0) - (a.win_streak || 0);
    return (b.wins || 0) - (a.wins || 0);
  });

  return allStats.slice(0, limit || 20);
}

function matchInit(ctx, logger, nk, params) {
  var mode = params && params.mode === "timed" ? "timed" : "classic";
  logger.info("Creating Tic-Tac-Toe match, mode: %s", mode);
  return { state: createInitialState(mode), tickRate: TICK_RATE, label: mode };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  if (state.pendingLeaves && state.pendingLeaves.indexOf(presence.userId) !== -1) {
    state.pendingLeaves = state.pendingLeaves.filter(function(id) { return id !== presence.userId; });
  }
  var existingSlot = state.players.indexOf(presence.userId);
  if (existingSlot !== -1) {
    return { state: state, accept: true };
  }
  var slot = state.players[0] === null ? 0 : state.players[1] === null ? 1 : -1;
  return { state: state, accept: slot !== -1 };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var pi = 0; pi < presences.length; pi++) {
    var presence = presences[pi];
    var slot = state.players.indexOf(presence.userId);
    if (slot === -1) {
      slot = state.players[0] === null ? 0 : state.players[1] === null ? 1 : -1;
    }
    if (slot !== -1 && state.players[slot] === null) {
      state.players[slot] = presence.userId;
      state.usernames[slot] = presence.username || presence.userId;
    }
  }

  if (state.players[0] !== null && state.players[1] !== null && state.status === "waiting") {
    state.status = "playing";
    state.lastActivity = Date.now();
    if (state.mode === "timed") {
      state.deadlineStartTick = tick;
      state.deadlineTick = tick + TIMED_MODE_TICKS;
    }
  }
  dispatcher.broadcastMessage(2, encodeState(state));
  return { state: state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var li = 0; li < presences.length; li++) {
    var leavePresence = presences[li];
    var lSlot = state.players.indexOf(leavePresence.userId);
    if (lSlot !== -1) {
      if (state.status === "playing") {
        var oppSlot = lSlot === 0 ? 1 : 0;
        if (state.players[oppSlot] !== null) {
          state.status = "finished";
          state.winner = oppSlot;
          state.winningLine = null;
          var opponentId = state.players[oppSlot];
          var leaverId = leavePresence.userId;
          try { updateStats(nk, opponentId, state.usernames[oppSlot] || opponentId, "win"); } catch (e) {}
          try { updateStats(nk, leaverId, leavePresence.username || leaverId, "loss"); } catch (e) {}
          dispatcher.broadcastMessage(2, encodeState(state));
        }
      }
    }
  }
  return { state: state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  for (var mi = 0; mi < messages.length; mi++) {
    var message = messages[mi];
    if (message.opCode === 1) {
      var data = decodeMessage(message.data);
      logger.info("Move opCode=1 received - dataType: %s, decoded: %j, status: %s, turn: %v", typeof message.data, data, state.status, state.turn);
      if (!data || typeof data.cell !== "number") { logger.info("Move rejected: bad data"); continue; }

      var cell = data.cell;
      if (cell < 0 || cell > 8) { logger.info("Move rejected: cell out of range %v", cell); continue; }
      if (state.board[cell] !== "") { logger.info("Move rejected: cell not empty %v", cell); continue; }
      if (state.status !== "playing") { logger.info("Move rejected: status=%s", state.status); continue; }

      var currentPlayerId = state.players[state.turn];
      var senderId = message.sender ? (message.sender.userId || message.sender.user_id || '') : '';
      logger.info("Sender check - senderId: %s, currentPlayerId: %s", senderId, currentPlayerId);
      if (!senderId || senderId !== currentPlayerId) { logger.info("Move rejected: sender mismatch"); continue; }

      var symbol = state.turn === 0 ? "X" : "O";
      state.board[cell] = symbol;
      state.moveCount++;
      state.lastActivity = Date.now();

      var winResult = checkWin(state.board);
      if (winResult.winner !== null) {
        state.status = "finished";
        state.winner = winResult.winner;
        state.winningLine = winResult.winningLine;
        var winnerId = state.players[winResult.winner];
        var loserId = state.players[winResult.winner === 0 ? 1 : 0];
        try { if (winnerId) updateStats(nk, winnerId, state.usernames[winResult.winner] || winnerId, "win"); } catch (e) {}
        try { if (loserId) updateStats(nk, loserId, state.usernames[winResult.winner === 0 ? 1 : 0] || loserId, "loss"); } catch (e) {}
        dispatcher.broadcastMessage(2, encodeState(state));
      } else if (isBoardFull(state.board)) {
        state.status = "finished";
        state.winner = null;
        try { if (state.players[0]) updateStats(nk, state.players[0], state.usernames[0] || state.players[0], "draw"); } catch (e) {}
        try { if (state.players[1]) updateStats(nk, state.players[1], state.usernames[1] || state.players[1], "draw"); } catch (e) {}
        dispatcher.broadcastMessage(2, encodeState(state));
      } else {
        state.turn = state.turn === 0 ? 1 : 0;
        if (state.mode === "timed") {
          state.deadlineStartTick = tick;
          state.deadlineTick = tick + TIMED_MODE_TICKS;
        }
        dispatcher.broadcastMessage(2, encodeState(state));
      }
    } else if (message.opCode === 3) {
      if (state.status === "finished") {
        state.board = ["", "", "", "", "", "", "", "", ""];
        state.turn = 0;
        state.status = "playing";
        state.winner = null;
        state.winningLine = null;
        state.moveCount = 0;
        state.lastActivity = Date.now();
        if (state.mode === "timed") {
          state.deadlineStartTick = tick;
          state.deadlineTick = tick + TIMED_MODE_TICKS;
        }
        dispatcher.broadcastMessage(2, encodeState(state));
      }
    } else if (message.opCode === 4 || message.opCode === 5) {
      dispatcher.broadcastMessage(2, encodeState(state));
    }
  }

  if (state.status === "playing" && state.mode === "timed" && state.deadlineTick > 0 && tick >= state.deadlineTick) {
    state.status = "finished";
    state.winner = state.turn === 0 ? 1 : 0;
    state.winningLine = null;
    var loserIdT = state.players[state.turn];
    var winnerIdT = state.players[state.turn === 0 ? 1 : 0];
    try { if (winnerIdT) updateStats(nk, winnerIdT, state.usernames[state.turn === 0 ? 1 : 0] || winnerIdT, "win"); } catch (e) {}
    try { if (loserIdT) updateStats(nk, loserIdT, state.usernames[state.turn] || loserIdT, "loss"); } catch (e) {}
    dispatcher.broadcastMessage(2, encodeState(state));
  }

  return { state: state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  if (state.status === "playing") {
    try { if (state.players[0]) updateStats(nk, state.players[0], state.usernames[0] || state.players[0], "loss"); } catch (e) {}
    try { if (state.players[1]) updateStats(nk, state.players[1], state.usernames[1] || state.players[1], "loss"); } catch (e) {}
    state.status = "finished";
  }
  return { state: state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  if (data === "rematch" && state.status === "finished") {
    state.board = ["", "", "", "", "", "", "", "", ""];
    state.turn = 0;
    state.status = "playing";
    state.winner = null;
    state.winningLine = null;
    state.moveCount = 0;
    state.lastActivity = Date.now();
    if (state.mode === "timed") {
      state.deadlineStartTick = tick;
      state.deadlineTick = tick + TIMED_MODE_TICKS;
    }
    dispatcher.broadcastMessage(2, encodeState(state));
  }
  return { state: state, data: "ok" };
}

function rpcCreateRoom(ctx, logger, nk, payload) {
  var userId = ctx.userId;
  var username = ctx.username || userId;
  var params = {};
  try { params = JSON.parse(payload || "{}"); } catch (e) {}

  var mode = params.mode === "timed" ? "timed" : "classic";
  var matchId = nk.matchCreate("tictactoe", { mode: mode }, true);
  try {
    nk.storageWrite([{
      collection: "rooms", key: matchId, userId: undefined,
      value: { matchId: matchId, hostId: userId, hostName: username, mode: mode, createdAt: Date.now(), status: "waiting" },
      permissionRead: 2, permissionWrite: 0
    }]);
  } catch (e) {}

  logger.info("Room created: %s, mode: %s", matchId, mode);
  return JSON.stringify({ matchId: matchId, mode: mode });
}

function rpcJoinRoom(ctx, logger, nk, payload) {
  var params = {};
  try { params = JSON.parse(payload || "{}"); } catch (e) {}

  if (!params.matchId) return JSON.stringify({ error: "matchId is required" });

  try {
    var records = nk.storageRead([
      { collection: "rooms", key: params.matchId, userId: "00000000-0000-0000-0000-000000000000" }
    ]);
    if (!records || records.length === 0) return JSON.stringify({ error: "Room not found" });
    var room = records[0].value;
    if (room.status !== "waiting") return JSON.stringify({ error: "Room is not available" });
    return JSON.stringify({ matchId: params.matchId, mode: room.mode });
  } catch (e) {
    return JSON.stringify({ error: "Room not found" });
  }
}

function rpcQueueMatchmaking(ctx, logger, nk, payload) {
  var userId = ctx.userId;
  var username = ctx.username || userId;
  var params = {};
  try { params = JSON.parse(payload || "{}"); } catch (e) {}

  var mode = params.mode === "timed" ? "timed" : "classic";

  if (activeTickets[userId]) {
    try { nk.matchmakerRemove(userId, activeTickets[userId]); } catch (e) {}
    delete activeTickets[userId];
  }

  try {
    var ticket = nk.matchmakerAdd(userId, username, { mode: mode }, {}, 2, 2, "", {});
    activeTickets[userId] = ticket.ticket;
    logger.info("Player %s added to Nakama matchmaker, mode: %s, ticket: %s", userId, mode, ticket.ticket);
    return JSON.stringify({ queued: true, mode: mode });
  } catch (e) {
    logger.info("Matchmaker error for %s: %s", userId, String(e));
    return JSON.stringify({ queued: true, mode: mode });
  }
}

function rpcCancelMatchmaking(ctx, logger, nk, payload) {
  var userId = ctx.userId;

  if (activeTickets[userId]) {
    try { nk.matchmakerRemove(userId, activeTickets[userId]); } catch (e) {}
    delete activeTickets[userId];
    logger.info("Player %s removed from Nakama matchmaker", userId);
  }
  return JSON.stringify({ ok: true });
}

function rpcGetLeaderboard(ctx, logger, nk, payload) {
  var params = {};
  try { params = JSON.parse(payload || "{}"); } catch (e) {}
  var leaderboard = getLeaderboardData(nk, params.limit || 20);
  return JSON.stringify(leaderboard);
}

function rpcGetPlayerStats(ctx, logger, nk, payload) {
  var userId = ctx.userId;
  var username = ctx.username || userId;
  var collection = "player_stats";
  var key = userId;

  try {
    var result = nk.storageRead([
      { collection: collection, key: key, userId: "00000000-0000-0000-0000-000000000000" }
    ]);
    if (result && result.length > 0) {
      return JSON.stringify(result[0].value);
    }
  } catch (e) {}

  var stats = { user_id: userId, username: username, wins: 0, losses: 0, draws: 0, win_streak: 0, best_streak: 0, last_result: "none" };
  try {
    nk.storageWrite([{ collection: collection, key: key, userId: undefined, value: stats, permissionRead: 2, permissionWrite: 0 }]);
  } catch (e) {}
  return JSON.stringify(stats);
}

function matchmakerMatchedHandler(ctx, logger, nk, matches) {
  try {
    var mode = "classic";
    if (matches && matches.length > 0) {
      var props = matches[0].stringProperties;
      if (props && props.mode === "timed") {
        mode = "timed";
      }
    }
    var matchId = nk.matchCreate("tictactoe", { mode: mode });
    logger.info("Matchmaker created authoritative match: %s, mode: %s", matchId, mode);
    return matchId;
  } catch (e) {
    logger.error("Matchmaker failed to create authoritative match: %s", String(e));
  }
}

function InitModule(ctx, logger, nk, initializer) {
  logger.info("Initializing Tic-Tac-Toe module...");

  initializer.registerMatchmakerMatched(matchmakerMatchedHandler);

  initializer.registerMatch("tictactoe", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal
  });

  initializer.registerRpc("create_room", rpcCreateRoom);
  initializer.registerRpc("join_room", rpcJoinRoom);
  initializer.registerRpc("queue_matchmaking", rpcQueueMatchmaking);
  initializer.registerRpc("cancel_matchmaking", rpcCancelMatchmaking);
  initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
  initializer.registerRpc("get_player_stats", rpcGetPlayerStats);

  logger.info("Tic-Tac-Toe module initialized successfully.");
}
