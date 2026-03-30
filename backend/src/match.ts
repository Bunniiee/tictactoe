/// <reference path="../node_modules/nakama-runtime/index.d.ts" />

export type GameMode = "classic" | "timed";
export type CellValue = "X" | "O" | "";
export type GameStatus = "waiting" | "playing" | "finished";

export interface MatchmakingPlayer {
  userId: string;
  username: string;
  mode: GameMode;
  joinedAt: number;
}

export interface TicTacToeState {
  board: CellValue[];
  players: [string | null, string | null];
  usernames: [string | null, string | null];
  turn: 0 | 1;
  status: GameStatus;
  mode: GameMode;
  winner: 0 | 1 | null;
  winningLine: number[] | null;
  moveCount: number;
  lastActivity: number;
  deadlineTick: number;
  deadlineStartTick: number;
  pendingLeaves: string[];
}

const TICK_RATE = 2;
const TIMED_MODE_SECONDS = 30;
const TIMED_MODE_TICKS = TIMED_MODE_SECONDS * TICK_RATE;

const WINNING_LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const matchmakingQueues: Map<GameMode, MatchmakingPlayer[]> = new Map([
  ["classic", []],
  ["timed", []]
]);

function createInitialState(mode: GameMode): TicTacToeState {
  return {
    board: Array(9).fill(""),
    players: [null, null],
    usernames: [null, null],
    turn: 0,
    status: "waiting",
    mode,
    winner: null,
    winningLine: null,
    moveCount: 0,
    lastActivity: Date.now(),
    deadlineTick: 0,
    deadlineStartTick: 0,
    pendingLeaves: []
  };
}

function checkWin(board: CellValue[]): { winner: 0 | 1 | null; winningLine: number[] | null } {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a] === "X" ? 0 : 1, winningLine: line };
    }
  }
  return { winner: null, winningLine: null };
}

function isBoardFull(board: CellValue[]): boolean {
  return board.every(cell => cell !== "");
}

function decodeMessage(data: Uint8Array): any {
  if (!data || data.length === 0) return null;
  try {
    const jsonString = String.fromCharCode(...data);
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}

function encodeState(state: TicTacToeState): Uint8Array {
  const json = JSON.stringify(state);
  return new TextEncoder().encode(json);
}

async function updateStats(
  nk: nkruntime.Nakama,
  userId: string,
  username: string,
  result: "win" | "loss" | "draw"
): Promise<void> {
  const collection = "player_stats";
  const key = userId;
  let stats: any;

  try {
    const resultRead = await nk.storageRead([
      { collection, key, userId: "00000000-0000-0000-0000-000000000000" }
    ]);
    if (resultRead && resultRead.length > 0) {
      stats = resultRead[0].value;
    } else {
      stats = { user_id: userId, username, wins: 0, losses: 0, draws: 0, win_streak: 0, best_streak: 0, last_result: "none" };
    }
  } catch {
    stats = { user_id: userId, username, wins: 0, losses: 0, draws: 0, win_streak: 0, best_streak: 0, last_result: "none" };
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

  await nk.storageWrite([{ collection, key, value: stats, permissionRead: 2, permissionWrite: 0 }]);
}

async function getLeaderboardData(nk: nkruntime.Nakama, limit: number = 20): Promise<any[]> {
  const allStats: any[] = [];
  try {
    const list = await nk.storageList("00000000-0000-0000-0000-000000000000", "player_stats", 100);
    const reads = (list as any[] || []).map((item: any) => ({
      collection: "player_stats",
      key: item.Key,
      userId: "00000000-0000-0000-0000-000000000000"
    }));
    if (reads.length > 0) {
      const results = await nk.storageRead(reads);
      for (const record of results) {
        if (record && record.value) allStats.push(record.value);
      }
    }
  } catch {}
  allStats.sort((a, b) => {
    const scoreA = (a.wins || 0) - (a.losses || 0);
    const scoreB = (b.wins || 0) - (b.losses || 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    if ((a.win_streak || 0) !== (b.win_streak || 0)) return (b.win_streak || 0) - (a.win_streak || 0);
    return (b.wins || 0) - (a.wins || 0);
  });
  return allStats.slice(0, limit);
}

let matchInit: nkruntime.MatchInitFunction<TicTacToeState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  params: { [key: string]: string }
) {
  const mode = (params?.mode as GameMode) || "classic";
  logger.info("Creating Tic-Tac-Toe match, mode: %s", mode);
  return {
    state: createInitialState(mode),
    tickRate: TICK_RATE,
    label: mode
  };
};

let matchJoinAttempt: nkruntime.MatchJoinAttemptFunction<TicTacToeState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: TicTacToeState,
  presence: nkruntime.Presence,
  metadata: { [key: string]: any }
) {
  if (state.pendingLeaves && state.pendingLeaves.includes(presence.userId)) {
    state.pendingLeaves = state.pendingLeaves.filter(id => id !== presence.userId);
  }
  const slot = state.players[0] === null ? 0 : state.players[1] === null ? 1 : -1;
  return { state, accept: slot !== -1 };
};

let matchJoin: nkruntime.MatchJoinFunction<TicTacToeState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: TicTacToeState,
  presences: nkruntime.Presence[]
) {
  for (const presence of presences) {
    let slot = state.players.indexOf(presence.userId);
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
    dispatcher.broadcastMessage(2, encodeState(state));
  }
  return { state };
};

let matchLeave: nkruntime.MatchLeaveFunction<TicTacToeState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: TicTacToeState,
  presences: nkruntime.Presence[]
) {
  for (const presence of presences) {
    const slot = state.players.indexOf(presence.userId);
    if (slot !== -1) {
      if (!state.pendingLeaves) state.pendingLeaves = [];
      state.pendingLeaves.push(presence.userId);
      if (state.status === "playing") {
        const opponentSlot = slot === 0 ? 1 : 0;
        if (state.players[opponentSlot] !== null) {
          state.status = "finished";
          state.winner = opponentSlot as 0 | 1;
          state.winningLine = null;
          const opponentId = state.players[opponentSlot];
          const leaverId = presence.userId;
          updateStats(nk, opponentId, state.usernames[opponentSlot] || opponentId, "win")
            .catch(e => logger.error("Stats update error: %v", e));
          updateStats(nk, leaverId, presence.username || leaverId, "loss")
            .catch(e => logger.error("Stats update error: %v", e));
          dispatcher.broadcastMessage(2, encodeState(state));
        }
      }
    }
  }
  return { state };
};

let matchLoop: nkruntime.MatchLoopFunction<TicTacToeState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: TicTacToeState,
  messages: nkruntime.MatchMessage[]
) {
  for (const message of messages) {
    if (message.opCode === 1) {
      const data = decodeMessage(message.data as Uint8Array);
      if (!data || typeof data.cell !== "number") continue;

      const cell = data.cell as number;
      if (cell < 0 || cell > 8) continue;
      if (state.board[cell] !== "") continue;
      if (state.status !== "playing") continue;

      const currentPlayerId = state.players[state.turn];
      if (message.sender?.userId !== currentPlayerId) continue;

      const symbol: CellValue = state.turn === 0 ? "X" : "O";
      state.board[cell] = symbol;
      state.moveCount++;
      state.lastActivity = Date.now();

      const { winner, winningLine } = checkWin(state.board);
      if (winner !== null) {
        state.status = "finished";
        state.winner = winner;
        state.winningLine = winningLine;
        const winnerId = state.players[winner];
        const loserId = state.players[winner === 0 ? 1 : 0];
        if (winnerId) updateStats(nk, winnerId, state.usernames[winner] || winnerId, "win")
          .catch(e => logger.error("Stats update error: %v", e));
        if (loserId) updateStats(nk, loserId, state.usernames[winner === 0 ? 1 : 0] || loserId, "loss")
          .catch(e => logger.error("Stats update error: %v", e));
      } else if (isBoardFull(state.board)) {
        state.status = "finished";
        state.winner = null;
        if (state.players[0]) updateStats(nk, state.players[0], state.usernames[0] || state.players[0], "draw")
          .catch(e => logger.error("Stats update error: %v", e));
        if (state.players[1]) updateStats(nk, state.players[1], state.usernames[1] || state.players[1], "draw")
          .catch(e => logger.error("Stats update error: %v", e));
      } else {
        state.turn = state.turn === 0 ? 1 : 0;
        if (state.mode === "timed") {
          state.deadlineStartTick = tick;
          state.deadlineTick = tick + TIMED_MODE_TICKS;
        }
      }
    } else if (message.opCode === 3) {
      if (state.status === "finished") {
        state.board = Array(9).fill("");
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
      }
    }
  }

  if (state.status === "playing" && state.mode === "timed" && state.deadlineTick > 0 && tick >= state.deadlineTick) {
    state.status = "finished";
    state.winner = state.turn === 0 ? 1 : 0;
    state.winningLine = null;
    const loserId = state.players[state.turn];
    const winnerId = state.players[state.turn === 0 ? 1 : 0];
    if (winnerId) updateStats(nk, winnerId, state.usernames[state.turn === 0 ? 1 : 0] || winnerId, "win")
      .catch(e => logger.error("Stats update error: %v", e));
    if (loserId) updateStats(nk, loserId, state.usernames[state.turn] || loserId, "loss")
      .catch(e => logger.error("Stats update error: %v", e));
  }

  dispatcher.broadcastMessage(2, encodeState(state));
  return { state };
};

let matchTerminate: nkruntime.MatchTerminateFunction<TicTacToeState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: TicTacToeState,
  graceSeconds: number
) {
  if (state.status === "playing") {
    if (state.players[0]) updateStats(nk, state.players[0], state.usernames[0] || state.players[0], "loss")
      .catch(e => logger.error("Stats update error: %v", e));
    if (state.players[1]) updateStats(nk, state.players[1], state.usernames[1] || state.players[1], "loss")
      .catch(e => logger.error("Stats update error: %v", e));
    state.status = "finished";
  }
  return { state };
};

let matchSignal: nkruntime.MatchSignalFunction<TicTacToeState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: TicTacToeState,
  data: string
) {
  if (data === "rematch" && state.status === "finished") {
    state.board = Array(9).fill("");
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
  return { state, data: "ok" };
};

let registerRpc: nkruntime.RpcFunction = async function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): Promise<string> {
  return "";
};

let rpcCreateRoom: nkruntime.RpcFunction = async function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): Promise<string> {
  const userId = ctx.userId!;
  const username = ctx.username || userId;
  let params: { mode?: string } = {};
  try { params = JSON.parse(payload || "{}"); } catch {}

  const mode: GameMode = (params.mode === "timed" ? "timed" : "classic") as GameMode;
  const matchId = await nk.matchCreate("tictactoe", { mode: mode });

  await nk.storageWrite([{
    collection: "rooms", key: matchId,
    value: { matchId, hostId: userId, hostName: username, mode, createdAt: Date.now(), status: "waiting" },
    permissionRead: 2, permissionWrite: 0
  }]);

  logger.info("Room created: %s, mode: %s", matchId, mode);
  return JSON.stringify({ matchId, mode });
};

let rpcJoinRoom: nkruntime.RpcFunction = async function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): Promise<string> {
  let params: { matchId?: string } = {};
  try { params = JSON.parse(payload || "{}"); } catch {}

  if (!params.matchId) return JSON.stringify({ error: "matchId is required" });

  try {
    const records = await nk.storageRead([
      { collection: "rooms", key: params.matchId, userId: "00000000-0000-0000-0000-000000000000" }
    ]);
    if (!records || records.length === 0) return JSON.stringify({ error: "Room not found" });
    const room = records[0].value;
    if (room.status !== "waiting") return JSON.stringify({ error: "Room is not available" });
    return JSON.stringify({ matchId: params.matchId, mode: room.mode });
  } catch {
    return JSON.stringify({ error: "Room not found" });
  }
};

let rpcQueueMatchmaking: nkruntime.RpcFunction = async function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): Promise<string> {
  const userId = ctx.userId!;
  const username = ctx.username || userId;
  let params: { mode?: string } = {};
  try { params = JSON.parse(payload || "{}"); } catch {}

  const mode: GameMode = (params.mode === "timed" ? "timed" : "classic") as GameMode;
  const queue = matchmakingQueues.get(mode)!;

  const existingIdx = queue.findIndex(p => p.userId === userId);
  if (existingIdx !== -1) queue.splice(existingIdx, 1);

  const opponent = queue.shift();
  if (opponent) {
    const matchId = await nk.matchCreate("tictactoe", { mode });
    await nk.storageWrite([{
      collection: "rooms", key: matchId,
      value: { matchId, player1Id: opponent.userId, player1Name: opponent.userName, player2Id: userId, player2Name: username, mode, createdAt: Date.now(), status: "playing" },
      permissionRead: 2, permissionWrite: 0
    }]);
    logger.info("Match created via matchmaking: %s, players: %s vs %s", matchId, opponent.userId, userId);
    return JSON.stringify({ matchId, mode, paired: true });
  }

  queue.push({ userId, username, mode, joinedAt: Date.now() });
  logger.info("Player %s joined matchmaking queue, mode: %s", userId, mode);
  return JSON.stringify({ queued: true, mode });
};

let rpcCancelMatchmaking: nkruntime.RpcFunction = async function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): Promise<string> {
  const userId = ctx.userId!;
  let params: { mode?: string } = {};
  try { params = JSON.parse(payload || "{}"); } catch {}

  const mode: GameMode = params.mode || "classic";
  const queue = matchmakingQueues.get(mode)!;
  const idx = queue.findIndex(p => p.userId === userId);
  if (idx !== -1) queue.splice(idx, 1);
  logger.info("Player %s cancelled matchmaking, mode: %s", userId, mode);
  return JSON.stringify({ ok: true });
};

let rpcGetLeaderboard: nkruntime.RpcFunction = async function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): Promise<string> {
  let params: { limit?: number } = {};
  try { params = JSON.parse(payload || "{}"); } catch {}

  const leaderboard = await getLeaderboardData(nk, params.limit || 20);
  return JSON.stringify(leaderboard);
};

let rpcGetPlayerStats: nkruntime.RpcFunction = async function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): Promise<string> {
  const userId = ctx.userId!;
  const username = ctx.username || userId;
  const collection = "player_stats";
  const key = userId;

  try {
    const result = await nk.storageRead([
      { collection, key, userId: "00000000-0000-0000-0000-000000000000" }
    ]);
    if (result && result.length > 0) {
      return JSON.stringify(result[0].value);
    }
  } catch {}

  const stats = { user_id: userId, username, wins: 0, losses: 0, draws: 0, win_streak: 0, best_streak: 0, last_result: "none" };
  await nk.storageWrite([{ collection, key, value: stats, permissionRead: 2, permissionWrite: 0 }]);
  return JSON.stringify(stats);
};

let InitModule: nkruntime.InitModule = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
) {
  logger.info("Initializing Tic-Tac-Toe module...");

  initializer.registerMatch("tictactoe", {
    matchInit,
    matchJoinAttempt,
    matchJoin,
    matchLeave,
    matchLoop,
    matchTerminate,
    matchSignal
  });

  initializer.registerRpc("create_room", rpcCreateRoom);
  initializer.registerRpc("join_room", rpcJoinRoom);
  initializer.registerRpc("queue_matchmaking", rpcQueueMatchmaking);
  initializer.registerRpc("cancel_matchmaking", rpcCancelMatchmaking);
  initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
  initializer.registerRpc("get_player_stats", rpcGetPlayerStats);

  logger.info("Tic-Tac-Toe module initialized successfully.");
};
