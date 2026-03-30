import { useEffect, useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useGame, GameMode } from '../context/GameContext'

export default function MatchmakingPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { socketRef, connectSocket, setCurrentMatchId } = useGame()
  const mode = (location.state as { mode?: GameMode })?.mode || 'classic'
  const [status, setStatus] = useState<'idle' | 'searching' | 'matched'>('idle')
  const [dots, setDots] = useState(0)
  const [error, setError] = useState('')
  const matchedRef = useRef(false)
  const socketSetupRef = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => setDots(d => (d + 1) % 4), 500)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    return () => {
      if (!matchedRef.current && socketRef.current) {
        try { socketRef.current.removeMatchmaker?.().catch(() => {}) } catch (_) {}
      }
    }
  }, [])

  const handleFindMatch = async () => {
    setStatus('searching')
    setError('')
    matchedRef.current = false

    try {
      console.log('[MATCHMAKING] Connecting socket...')
      await connectSocket()
      console.log('[MATCHMAKING] Socket connected, status:', socketRef.current ? 'OK' : 'NULL')
    } catch (err: any) {
      console.error('[MATCHMAKING] Connect error:', err)
      setStatus('idle')
      setError('Failed to connect: ' + (err?.message || 'Unknown error'))
      return
    }

    const socket = socketRef.current
    if (!socket) {
      console.error('[MATCHMAKING] Socket is null after connect')
      setError('Socket not connected. Please try again.')
      setStatus('idle')
      return
    }

    if (!socketSetupRef.current) {
        socket.onmatchmakermatched = async (result: any) => {
          console.log('[MATCHMAKING] Full matchmaker result:', JSON.stringify(result))
          if (matchedRef.current) return
          matchedRef.current = true

          const matchId = result.match_id || result.matchId
          const token = result.token

          if (matchId) {
            setStatus('matched')
            setCurrentMatchId(matchId)
            navigate(`/game/${matchId}`, { state: { matchId } })
          } else if (token) {
            try {
              const joinResult = await socket.joinMatch('', token)
              const realMatchId = joinResult.match_id
              setStatus('matched')
              setCurrentMatchId(realMatchId)
              navigate(`/game/${realMatchId}`, { state: { matchId: realMatchId, alreadyJoined: true } })
            } catch (e) {
              console.error('[MATCHMAKING] Failed to join via token:', e)
              matchedRef.current = false
              setStatus('idle')
              setError('Failed to join match')
            }
          } else {
            console.error('[MATCHMAKING] No matchId or token in result')
            matchedRef.current = false
          }
        }
      socketSetupRef.current = true
    }

    try {
      console.log('[MATCHMAKING] Adding to matchmaker...')
      const ticket = await socket.addMatchmaker('*', 2, 2, { mode })
      console.log('[MATCHMAKING] Matchmaker ticket:', ticket)
    } catch (err: any) {
      console.error('[MATCHMAKING] AddMatchmaker error:', err)
      setStatus('idle')
      setError(err?.message || 'Failed to find match')
    }
  }

  const handleCancel = async () => {
    if (socketRef.current) {
      try { await socketRef.current.removeMatchmaker?.() } catch (_) {}
    }
    matchedRef.current = true
    navigate('/')
  }

  const dotsDisplay = '.'.repeat(dots)

  return (
    <div className="page matchmaking-page">
      <div className="container">
        <div className="card card-center">
          {status === 'idle' && (
            <>
              <h2>Ready to Find Match</h2>
              <p>Mode: {mode === 'timed' ? 'Timed (30s)' : 'Classic'}</p>
              <button className="btn btn-primary btn-full" onClick={handleFindMatch}>
                Find Opponent
              </button>
            </>
          )}
          {status === 'searching' && (
            <>
              <div className="spinner"></div>
              <h2>Finding Opponent{dotsDisplay}</h2>
              <p>Mode: {mode === 'timed' ? 'Timed (30s)' : 'Classic'}</p>
              <p className="hint">Nakama is searching for an opponent</p>
            </>
          )}
          {status === 'matched' && (
            <>
              <div className="matched-icon">&#x2714;</div>
              <h2>Opponent Found!</h2>
              <p>Starting game...</p>
            </>
          )}

          {error && <div className="error-msg">{error}</div>}

          {status !== 'idle' && (
            <button className="btn btn-secondary btn-full" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
