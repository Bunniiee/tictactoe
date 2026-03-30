import { useEffect, useState } from 'react'

interface TimerProps {
  startTick: number
  endTick: number
  isMyTurn: boolean
}

const TOTAL_SECONDS = 30

export default function Timer({ startTick, endTick, isMyTurn }: TimerProps) {
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS)

  useEffect(() => {
    if (!isMyTurn || startTick === 0 || endTick === 0) {
      setSecondsLeft(TOTAL_SECONDS)
      return
    }

    setSecondsLeft(TOTAL_SECONDS)

    const interval = setInterval(() => {
      setSecondsLeft(prev => Math.max(0, prev - 1))
    }, 1000)

    return () => clearInterval(interval)
  }, [startTick, endTick, isMyTurn])

  const percentage = (secondsLeft / TOTAL_SECONDS) * 100
  const timerClass = secondsLeft <= 5 ? 'critical' : secondsLeft <= 10 ? 'warning' : ''

  if (!isMyTurn) {
    return (
      <div className="timer-bar-container">
        <p className="timer-text timer-opponent">Opponent's turn</p>
      </div>
    )
  }

  return (
    <div className="timer-bar-container">
      <div className="timer-label">
        <span>Your turn</span>
        <span className={`timer-seconds ${timerClass}`}>{secondsLeft}s</span>
      </div>
      <div className="timer-bar">
        <div
          className={`timer-fill ${timerClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
