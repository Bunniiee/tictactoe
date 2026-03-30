import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Client, Session } from '@heroiclabs/nakama-js'
import { NAKAMA_SERVER_URL } from '../lib/nakama'

export type GameMode = 'classic' | 'timed'
export type CellValue = 'X' | 'O' | ''
export type GameStatus = 'waiting' | 'playing' | 'finished'

export interface TicTacToeState {
  board: CellValue[]
  players: [string | null, string | null]
  usernames: [string | null, string | null]
  turn: 0 | 1
  status: GameStatus
  mode: GameMode
  winner: 0 | 1 | null
  winningLine: number[] | null
  moveCount: number
  lastActivity: number
  deadlineTick: number
  deadlineStartTick: number
  pendingLeaves: string[]
}

export interface PlayerStats {
  user_id: string
  username: string
  wins: number
  losses: number
  draws: number
  win_streak: number
  best_streak: number
  last_result: string
}

interface GameContextValue {
  client: Client
  session: Session | null
  username: string
  setUsername: (name: string) => void
  connectSocket: () => Promise<Session>
  disconnectSocket: () => void
  currentMatchId: string | null
  setCurrentMatchId: (id: string | null) => void
  gameState: TicTacToeState | null
  setGameState: (state: TicTacToeState | null) => void
  myPlayerIndex: number | null
  setMyPlayerIndex: (index: number | null) => void
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  setConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void
  queueMatchmaking: (mode: GameMode) => Promise<{ matchId?: string; paired?: boolean; queued?: boolean }>
  cancelMatchmaking: (mode: GameMode) => Promise<void>
  makeMove: (cell: number) => void
  requestRematch: () => void
  getLeaderboard: () => Promise<PlayerStats[]>
  getPlayerStats: () => Promise<PlayerStats>
  socketRef: React.MutableRefObject<any>
}

const GameContext = createContext<GameContextValue | null>(null)

const serverUrl = NAKAMA_SERVER_URL.replace('http://', '').replace('https://', '').replace(/:.*$/, '')
const useSSL = NAKAMA_SERVER_URL.startsWith('https')
const port = useSSL ? '443' : '7350'
const client = new Client('defaultkey', serverUrl, port, useSSL)

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [username, setUsername] = useState('')
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null)
  const [gameState, setGameState] = useState<TicTacToeState | null>(null)
  const [myPlayerIndex, setMyPlayerIndex] = useState<number | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

  const socketRef = useRef<any>(null)

  const connectSocket = useCallback(async (): Promise<Session> => {
    setConnectionStatus('connecting')
    try {
      const storedToken = sessionStorage.getItem('ttt_auth_token')
      const storedRefresh = sessionStorage.getItem('ttt_refresh_token')

      let sess: Session

      if (storedToken && storedRefresh) {
        sess = Session.restore(storedToken, storedRefresh)
        if (sess.isexpired(Math.floor(Date.now() / 1000))) {
          try {
            sess = await client.sessionRefresh(sess)
          } catch {
            const newId = crypto.randomUUID() + '-' + Math.random().toString(36).slice(2, 10)
            const name = username || sessionStorage.getItem('ttt_username') || `Player${Math.floor(Math.random() * 9000) + 1000}`
            sess = await client.authenticateCustom(newId, true, name)
            sessionStorage.setItem('ttt_custom_id', newId)
          }
        }
      } else {
        const newId = crypto.randomUUID() + '-' + Math.random().toString(36).slice(2, 10)
        const name = username || sessionStorage.getItem('ttt_username') || `Player${Math.floor(Math.random() * 9000) + 1000}`
        setUsername(name)
        sess = await client.authenticateCustom(newId, true, name)
        sessionStorage.setItem('ttt_custom_id', newId)
        sessionStorage.setItem('ttt_username', sess.username || name)
      }

      sessionStorage.setItem('ttt_auth_token', sess.token)
      sessionStorage.setItem('ttt_refresh_token', sess.refresh_token || '')
      sessionStorage.setItem('ttt_user_id', sess.user_id || '')

      if (!socketRef.current) {
        socketRef.current = client.createSocket()
        socketRef.current.onerror = () => setConnectionStatus('error')
        socketRef.current.onclose = () => {
          socketRef.current = null
          setConnectionStatus('disconnected')
        }
        await socketRef.current.connect(sess, true)
      }

      setSession(sess)
      setConnectionStatus('connected')
      return sess
    } catch (err) {
      setConnectionStatus('error')
      throw err
    }
  }, [username])

  const disconnectSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
    setSession(null)
    setCurrentMatchId(null)
    setGameState(null)
    setMyPlayerIndex(null)
    setConnectionStatus('disconnected')
  }, [])

  const queueMatchmaking = useCallback(async (mode: GameMode): Promise<{ matchId?: string; paired?: boolean; queued?: boolean }> => {
    if (!session) throw new Error('Not connected')
    const result = await client.rpc(session, 'queue_matchmaking', { mode })
    const payload = result.payload as any
    return typeof payload === 'string' ? JSON.parse(payload) : payload
  }, [session])

  const cancelMatchmaking = useCallback(async (mode: GameMode): Promise<void> => {
    if (!session) return
    await client.rpc(session, 'cancel_matchmaking', { mode })
  }, [session])

  const makeMove = useCallback((cell: number) => {
    console.log('[GAME] makeMove - cell:', cell, '| matchId:', currentMatchId, '| hasSocket:', !!socketRef.current)
    if (!socketRef.current || !currentMatchId) return
    socketRef.current.sendMatchState(currentMatchId, 1, JSON.stringify({ cell }))
  }, [currentMatchId])

  const requestRematch = useCallback(() => {
    if (!socketRef.current || !currentMatchId) return
    socketRef.current.sendMatchState(currentMatchId, 3, new Uint8Array())
  }, [currentMatchId])

  const getLeaderboard = useCallback(async (): Promise<PlayerStats[]> => {
    if (!session) return []
    const result = await client.rpc(session, 'get_leaderboard', { limit: 20 })
    const payload = result.payload as any
    return typeof payload === 'string' ? JSON.parse(payload) : (Array.isArray(payload) ? payload : [])
  }, [session])

  const getPlayerStats = useCallback(async (): Promise<PlayerStats> => {
    if (!session) return { user_id: '', username: '', wins: 0, losses: 0, draws: 0, win_streak: 0, best_streak: 0, last_result: 'none' }
    const result = await client.rpc(session, 'get_player_stats', {})
    const payload = result.payload as any
    return typeof payload === 'string' ? JSON.parse(payload) : (payload || {})
  }, [session])

  return (
    <GameContext.Provider value={{
      client,
      session,
      username,
      setUsername,
      connectSocket,
      disconnectSocket,
      currentMatchId,
      setCurrentMatchId,
      gameState,
      setGameState,
      myPlayerIndex,
      setMyPlayerIndex,
      connectionStatus,
      setConnectionStatus,
      queueMatchmaking,
      cancelMatchmaking,
      makeMove,
      requestRematch,
      getLeaderboard,
      getPlayerStats,
      socketRef
    }}>
      {children}
    </GameContext.Provider>
  )
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used within GameProvider')
  return ctx
}
