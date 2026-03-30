import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame, PlayerStats } from '../context/GameContext'

export default function LeaderboardPage() {
  const navigate = useNavigate()
  const { session, getLeaderboard, getPlayerStats, connectSocket } = useGame()
  const [leaderboard, setLeaderboard] = useState<PlayerStats[]>([])
  const [myStats, setMyStats] = useState<PlayerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        if (!session) await connectSocket()
        const [lb, stats] = await Promise.all([getLeaderboard(), getPlayerStats()])
        setLeaderboard(lb)
        setMyStats(stats)
      } catch (err: any) {
        setError(err?.message || 'Failed to load leaderboard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [session, getLeaderboard, getPlayerStats, connectSocket])

  return (
    <div className="page leaderboard-page">
      <div className="container">
        <div className="game-header">
          <button className="btn btn-back" onClick={() => navigate('/')}>
            &#x2190; Back
          </button>
          <h2>Leaderboard</h2>
        </div>

        {loading && (
          <div className="loading-state">
            <div className="spinner"></div>
          </div>
        )}

        {error && <div className="error-msg">{error}</div>}

        {myStats && (
          <div className="card my-stats-card">
            <h3>Your Stats</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">{myStats.wins || 0}</span>
                <span className="stat-label">Wins</span>
              </div>
              <div className="stat">
                <span className="stat-value">{myStats.losses || 0}</span>
                <span className="stat-label">Losses</span>
              </div>
              <div className="stat">
                <span className="stat-value">{myStats.draws || 0}</span>
                <span className="stat-label">Draws</span>
              </div>
              <div className="stat">
                <span className="stat-value">{myStats.win_streak || 0}</span>
                <span className="stat-label">Streak</span>
              </div>
              <div className="stat">
                <span className="stat-value">{myStats.best_streak || 0}</span>
                <span className="stat-label">Best Streak</span>
              </div>
            </div>
          </div>
        )}

        <div className="leaderboard-list">
          {leaderboard.length === 0 && !loading && (
            <div className="empty-state">
              <p>No players yet. Be the first!</p>
            </div>
          )}
          {leaderboard.map((player, index) => (
            <div
              key={player.user_id}
              className={`leaderboard-row ${myStats?.user_id === player.user_id ? 'me' : ''}`}
            >
              <span className="rank">#{index + 1}</span>
              <span className="player-name">{player.username}</span>
              <div className="player-record">
                <span className="wins">{player.wins || 0}W</span>
                <span className="losses">{player.losses || 0}L</span>
                <span className="draws">{player.draws || 0}D</span>
              </div>
              <span className="streak">{player.win_streak || 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
