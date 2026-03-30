import { CellValue } from '../context/GameContext'

interface BoardProps {
  board: CellValue[]
  winningLine: number[] | null
  onCellClick: (cell: number) => void
  disabled: boolean
}

export default function Board({ board, winningLine, onCellClick, disabled }: BoardProps) {
  return (
    <div className="board">
      {board.map((cell, index) => {
        const isWinningCell = winningLine?.includes(index)
        return (
          <button
            key={index}
            className={`cell ${cell} ${isWinningCell ? 'winning' : ''} ${disabled ? 'disabled' : ''}`}
            onClick={() => onCellClick(index)}
            disabled={disabled || cell !== ''}
            aria-label={`Cell ${index + 1}: ${cell || 'empty'}`}
          >
            {cell && <span className="cell-symbol">{cell}</span>}
          </button>
        )
      })}
    </div>
  )
}
