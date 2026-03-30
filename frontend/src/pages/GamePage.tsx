import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useGame, TicTacToeState } from '../context/GameContext'
import Board from '../components/Board'
import Timer from '../components/Timer'

export default function GamePage() {
  const routeParams = useParams<{ matchId: string }>()
  const location = useLocation()
  const stateMatchId = (location.state as { matchId?: string })?.matchId
  const matchToken = (location.state as { token?: string })?.token
  const alreadyJoined = (location.state as any)?.alreadyJoined === true
  const urlPathname = window.location.pathname
  const urlMatchId = urlPathname.split('/').pop() || ''
  const resolvedMatchId = routeParams.matchId || stateMatchId || urlMatchId

  console.log('[GAME] URL parsing:', {
    routeParams: routeParams,
    stateMatchId: stateMatchId,
    urlPathname: urlPathname,
    urlMatchId: urlMatchId,
    resolvedMatchId: resolvedMatchId,
    matchToken: matchToken ? 'present' : 'missing'
  })

  const navigate = useNavigate()
  const {
    client,
    session,
    socketRef,
    setCurrentMatchId,
    gameState,
    setGameState,
    myPlayerIndex,
    setMyPlayerIndex,
    makeMove,
    requestRematch,
    connectionStatus,
    setConnectionStatus
  } = useGame()
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(true)
  const connectedRef = useRef(false)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const userIdRef = useRef<string>('')
  if (session && (session as any).user_id && !userIdRef.current) {
    userIdRef.current = (session as any).user_id
  }

  const handleStateUpdate = useCallback((state: TicTacToeState) => {
    setGameState(state)
    const sess = sessionRef.current
    const uid = userIdRef.current || (sess as any)?.user_id || (sess as any)?.uid || sessionStorage.getItem('ttt_user_id') || ''
    console.log('[GAME] handleStateUpdate - status:', state.status, 'players:', state.players, 'myUid:', uid, 'turn:', state.turn)
    if (uid && state.players) {
      if (!userIdRef.current) userIdRef.current = uid
      const idx = state.players.indexOf(uid)
      console.log('[GAME] myPlayerIndex resolved:', idx, 'from players:', state.players)
      if (idx !== -1) {
        setMyPlayerIndex(idx)
      }
    }
  }, [setGameState, setMyPlayerIndex])

  useEffect(() => {
    console.log('[GAME] useEffect run - resolvedMatchId:', resolvedMatchId, 'session:', !!session, 'stateMatchId:', stateMatchId)
    if (!resolvedMatchId || !session) {
      console.log('[GAME] Missing data - resolvedMatchId:', resolvedMatchId, 'stateMatchId:', stateMatchId)
      return
    }
    if (connectedRef.current) {
      console.log('[GAME] Already connected, skipping')
      return
    }
    connectedRef.current = true
    setJoining(true)

    const existingSocket = socketRef.current
    console.log('[GAME] Existing socket:', !!existingSocket)

    const connect = async () => {
      try {
        setConnectionStatus('connecting')
        const socket = existingSocket || client.createSocket()
        socketRef.current = socket

        socket.onmatchdata = (result: any) => {
          console.log('[GAME] Match data received, opCode:', result.op_code)
          try {
            const raw = result.data
            let text: string
            if (typeof raw === 'string') {
              const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
              text = new TextDecoder().decode(bytes)
            } else if (raw instanceof Uint8Array) {
              text = new TextDecoder().decode(raw)
            } else if (raw && typeof raw === 'object') {
              const vals = Object.values(raw) as number[]
              text = String.fromCharCode(...vals)
            } else {
              console.warn('[GAME] No data in match message')
              setJoining(false)
              return
            }
            const parsed = JSON.parse(text)
            console.log('[GAME] Parsed state - status:', parsed?.status, 'players:', parsed?.players, 'board:', parsed?.board)
            if (parsed && parsed.board && Array.isArray(parsed.board)) {
              handleStateUpdate(parsed)
              setJoining(false)
              return
            }
            console.warn('[GAME] State missing board array:', parsed)
          } catch (e) {
            console.error('[GAME] Failed to parse match data:', e)
          }
          setJoining(false)
        }

        socket.onmatchpresence = (_: any) => {}

        socket.onmatchsignal = (_: any) => {}

        socket.onmatchmatchmakermatched = (result: any) => {
          if (result.match_id) {
            setCurrentMatchId(result.match_id)
            navigate(`/game/${result.match_id}`)
          }
        }

        socket.onerror = () => {
          setError('Connection error')
          setConnectionStatus('error')
        }

        socket.onclose = () => {
          connectedRef.current = false
          setConnectionStatus('disconnected')
        }

        if (!existingSocket) {
          await socket.connect(session, true)
        }

        try {
          if (!alreadyJoined) {
            console.log('[GAME] Joining match - matchId:', resolvedMatchId, 'token:', matchToken ? 'present' : 'none')
            await socket.joinMatch(resolvedMatchId, matchToken || undefined)
            console.log('[GAME] Successfully joined match')
          } else {
            console.log('[GAME] Already joined match via matchmaker, skipping joinMatch')
          }
          setCurrentMatchId(resolvedMatchId)
          setConnectionStatus('connected')
          setTimeout(() => {
            console.log('[GAME] Requesting state...')
            socket.sendMatchState(resolvedMatchId, 5, new Uint8Array())
          }, 500)
          setTimeout(() => {
            console.log('[GAME] Safety timeout - forcing joining=false')
            setJoining(false)
          }, 5000)
        } catch (joinErr: any) {
          console.error('[GAME] Join error:', joinErr)
          const errCode = joinErr?.code
          const errMsg = joinErr?.message || ''
          if (errCode === 5 || errMsg.includes('not found') || errMsg.includes('expired')) {
            setError('Room not found or expired')
          } else {
            setError(joinErr?.message || 'Failed to join match')
          }
          setConnectionStatus('error')
          setJoining(false)
        }
      } catch (err: any) {
        console.error('[GAME] Connection error:', err)
        setError(err?.message || 'Failed to connect')
        setConnectionStatus('error')
        setJoining(false)
      }
    }

    connect()

    return () => {
      connectedRef.current = false
      setCurrentMatchId(null)
      setGameState(null)
      setMyPlayerIndex(null)
    }
  }, [resolvedMatchId, session])

  const handleCellClick = (cell: number) => {
    console.log('[GAME] Cell clicked:', cell, '| gameState:', !!gameState, '| status:', gameState?.status, '| myPlayerIndex:', myPlayerIndex, '| turn:', gameState?.turn, '| cell value:', gameState?.board[cell])
    if (!gameState) return
    if (gameState.status !== 'playing') return
    if (gameState.board[cell] !== '') return
    if (myPlayerIndex === null) return
    if (gameState.turn !== myPlayerIndex) return
    makeMove(cell)
  }

  const getResultMessage = () => {
    if (!gameState || gameState.status !== 'finished') return null
    if (gameState.winner === null) return "It's a draw!"
    const isWinner = gameState.winner === myPlayerIndex
    if (isWinner) return 'You win!'
    return 'You lose!'
  }

  const opponentIndex = myPlayerIndex === 0 ? 1 : myPlayerIndex === 1 ? 0 : null

  return (
    <div className="page game-page">
      <div className="container">
        <div className="game-header">
          <button className="btn btn-back" onClick={() => navigate('/')}>
            &#x2190; Menu
          </button>
          <span className={`connection-dot ${connectionStatus}`}></span>
        </div>

        {joining && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <p>Joining match...</p>
          </div>
        )}

        {error && (
          <div className="card card-center">
            <div className="error-msg">{error}</div>
            <button className="btn btn-primary btn-full" onClick={() => navigate('/')}>
              Back to Menu
            </button>
          </div>
        )}

        {gameState && !error && (
          <>
            <div className="players-bar">
              <div className={`player-card ${gameState.turn === 0 && gameState.status === 'playing' ? 'active' : ''} ${gameState.winner === 0 ? 'winner' : ''} ${myPlayerIndex === 0 ? 'me' : ''}`}>
                <span className="player-mark">X</span>
                <span className="player-name">{gameState.usernames[0] || 'Player 1'}</span>
                {myPlayerIndex === 0 && <span className="you-badge">You</span>}
              </div>
              <div className="vs-text">VS</div>
              <div className={`player-card ${gameState.turn === 1 && gameState.status === 'playing' ? 'active' : ''} ${gameState.winner === 1 ? 'winner' : ''} ${myPlayerIndex === 1 ? 'me' : ''}`}>
                <span className="player-mark">O</span>
                <span className="player-name">{gameState.usernames[1] || 'Player 2'}</span>
                {myPlayerIndex === 1 && <span className="you-badge">You</span>}
              </div>
            </div>

            {gameState.mode === 'timed' && gameState.status === 'playing' && (
              <Timer
                startTick={gameState.deadlineStartTick}
                endTick={gameState.deadlineTick}
                isMyTurn={gameState.turn === myPlayerIndex}
              />
            )}

            {gameState.status === 'waiting' && (
              <div className="game-status waiting">
                <div className="spinner"></div>
                <p>Waiting for opponent...</p>
              </div>
            )}

            {gameState.status === 'playing' && (
              <div className="turn-indicator">
                {gameState.turn === myPlayerIndex
                  ? 'Your turn'
                  : `${gameState.usernames[opponentIndex ?? 0] || 'Opponent'}'s turn`}
              </div>
            )}

            {gameState.status === 'finished' && (
              <div className="game-result">
                <h2>{getResultMessage()}</h2>
                {gameState.winningLine && <p>Winning line highlighted!</p>}
                <button className="btn btn-primary" onClick={requestRematch}>
                  Rematch
                </button>
              </div>
            )}

            <Board
              board={gameState.board}
              winningLine={gameState.winningLine}
              onCellClick={handleCellClick}
              disabled={
                gameState.status !== 'playing' ||
                myPlayerIndex === null ||
                gameState.turn !== myPlayerIndex
              }
            />

            <div className="mode-badge">
              {gameState.mode === 'timed' ? 'Timed Mode (30s/turn)' : 'Classic Mode'}
            </div>
          </>
        )}

        {!gameState && !joining && !error && (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Connecting to game...</p>
          </div>
        )}
      </div>
    </div>
  )
}
