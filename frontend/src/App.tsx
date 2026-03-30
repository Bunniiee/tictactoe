import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { GameProvider } from './context/GameContext'
import HomePage from './pages/HomePage'
import MatchmakingPage from './pages/MatchmakingPage'
import GamePage from './pages/GamePage'
import LeaderboardPage from './pages/LeaderboardPage'

export default function App() {
  return (
    <GameProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/matchmaking" element={<MatchmakingPage />} />
          <Route path="/game/:matchId" element={<GamePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
        </Routes>
      </BrowserRouter>
    </GameProvider>
  )
}
