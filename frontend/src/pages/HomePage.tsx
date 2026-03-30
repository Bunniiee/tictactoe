import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'

export default function HomePage() {
  const { connectSocket, session, username, setUsername, connectionStatus, getPlayerStats } = useGame()
  const navigate = useNavigate()
  const [playerStats, setPlayerStats] = useState<any>(null)
  const [roomCode, setRoomCode] = useState('')
  const [mode, setMode] = useState<'classic' | 'timed'>('classic')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (session) {
      getPlayerStats().then(setPlayerStats).catch(() => {})
    }
  }, [session, getPlayerStats])

  const handleConnect = async () => {
    setLoading(true)
    setError('')
    try {
      await connectSocket()
    } catch (err: any) {
      const msg = err?.message || (err?.status ? `HTTP ${err.status}` : 'Unknown error')
      setError('Failed to connect: ' + msg)
    } finally {
      setLoading(false)
    }
  }

  const handleQuickPlay = async () => {
    if (!session) {
      setError('Please connect first')
      return
    }
    setLoading(true)
    setError('')
    try {
      navigate('/matchmaking', { state: { mode } })
    } catch (err: any) {
      setError(err?.message || 'Failed to start matchmaking')
    } finally {
      setLoading(false)
    }
  }

  const handleJoinRoom = async () => {
    if (!session || !roomCode.trim()) return
    setLoading(true)
    setError('')
    try {
      const matchId = roomCode.trim()
      navigate(`/game/${matchId}`)
    } catch (err: any) {
      setError(err?.message || 'Failed to join room')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page home-page">
      <div className="container">
        <div className="header">
          <h1 className="title">Tic-Tac-Toe</h1>
          <p className="subtitle">Nakama Multiplayer</p>
        </div>

        <div className="card">
          {!session ? (
            <>
              <div className="form-group">
                <label htmlFor="username">Your Name</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="Enter your name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={20}
                />
              </div>
              <button className="btn btn-primary btn-full" onClick={handleConnect} disabled={loading}>
                {loading ? 'Connecting...' : 'Connect to Server'}
              </button>
            </>
          ) : (
            <>
              <div className="player-info">
                <div className="player-name">
                  <span className="label">Playing as</span>
                  <span className="value">{session.username}</span>
                </div>
                <div className="mode-selector">
                  <label className="label">Game Mode</label>
                  <div className="mode-buttons">
                    <button
                      className={`mode-btn ${mode === 'classic' ? 'active' : ''}`}
                      onClick={() => setMode('classic')}
                    >
                      Classic
                    </button>
                    <button
                      className={`mode-btn ${mode === 'timed' ? 'active' : ''}`}
                      onClick={() => setMode('timed')}
                    >
                      Timed (30s)
                    </button>
                  </div>
                </div>
              </div>

              {playerStats && (
                <div className="stats-summary">
                  <div className="stat-item">
                    <span className="stat-value">{playerStats.wins || 0}</span>
                    <span className="stat-label">Wins</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{playerStats.losses || 0}</span>
                    <span className="stat-label">Losses</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{playerStats.win_streak || 0}</span>
                    <span className="stat-label">Streak</span>
                  </div>
                </div>
              )}

              <button className="btn btn-primary btn-full" onClick={handleQuickPlay} disabled={loading}>
                {loading ? 'Starting...' : mode === 'timed' ? 'Quick Play (Timed)' : 'Quick Play'}
              </button>

              <div className="divider">
                <span>or join a room</span>
              </div>

              <div className="form-group">
                <input
                  id="roomCode"
                  name="roomCode"
                  type="text"
                  placeholder="Enter room match ID"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  maxLength={50}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                />
              </div>
              <button className="btn btn-secondary btn-full" onClick={handleJoinRoom} disabled={loading || !roomCode.trim()}>
                Join Room
              </button>

              <button className="btn btn-link" onClick={() => navigate('/leaderboard')}>
                View Leaderboard
              </button>
            </>
          )}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="connection-status">
          <span className={`status-dot ${connectionStatus}`}></span>
          <span className="status-text">{connectionStatus}</span>
        </div>
      </div>
    </div>
  )
}
