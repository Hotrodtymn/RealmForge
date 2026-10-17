import { useState } from 'react'
import { DIE_SIDES, rollDice, type DiceRollResult, type DieSides, type RollMode } from './dice'

interface RollHistoryEntry {
  id: number
  rolledAt: Date
  result: DiceRollResult
}

const diceLabels: Record<DieSides, string> = {
  4: 'Tetrahedron',
  6: 'Cube',
  8: 'Octahedron',
  10: 'Pentagonal trapezohedron',
  12: 'Dodecahedron',
  20: 'Icosahedron',
  100: 'Percentile',
}

function DiceRoller() {
  const [sides, setSides] = useState<DieSides>(20)
  const [diceCount, setDiceCount] = useState('1')
  const [modifier, setModifier] = useState('0')
  const [mode, setMode] = useState<RollMode>('normal')
  const [lastResult, setLastResult] = useState<DiceRollResult | null>(null)
  const [history, setHistory] = useState<RollHistoryEntry[]>([])
  const [error, setError] = useState('')
  const [nextHistoryId, setNextHistoryId] = useState(1)

  const countValue = Number(diceCount)
  const canUseD20Modes = sides === 20 && countValue === 1

  const setCount = (value: string) => {
    setDiceCount(value)
    if (mode !== 'normal' && !(sides === 20 && Number(value) === 1)) setMode('normal')
  }

  const setDie = (value: DieSides) => {
    setSides(value)
    if (mode !== 'normal' && !(value === 20 && countValue === 1)) setMode('normal')
  }

  const roll = () => {
    setError('')
    try {
      if (modifier.trim() === '') throw new RangeError('Enter a whole number modifier from -1000 to 1000.')
      const result = rollDice({ diceCount: countValue, sides, modifier: Number(modifier), mode })
      setLastResult(result)
      setHistory((previous) => [{ id: nextHistoryId, rolledAt: new Date(), result }, ...previous].slice(0, 20))
      setNextHistoryId((id) => id + 1)
    } catch (rollError) {
      setError(rollError instanceof Error ? rollError.message : 'Could not roll these dice.')
    }
  }

  return (
    <section className="dice-roller-view" id="dice-roller" aria-labelledby="dice-heading">
      <div className="dice-page-heading">
        <div className="eyebrow"><span className="eyebrow-line" />FATE IS IN YOUR HANDS</div>
        <h1 id="dice-heading">Dice <em>Roller</em></h1>
        <p>Set your roll, call your luck, and let the dice decide.</p>
      </div>

      <div className="dice-layout">
        <div className="dice-panel dice-controls-panel">
          <div className="dice-panel-heading"><div className="eyebrow small"><span className="eyebrow-line" />CHOOSE YOUR DICE</div><span className="dice-panel-mark">⚄</span></div>

          <div className="die-picker" role="group" aria-label="Die type">
            {DIE_SIDES.map((dieSides) => (
              <button
                type="button"
                className={`die-choice${sides === dieSides ? ' selected' : ''}`}
                key={dieSides}
                onClick={() => setDie(dieSides)}
                aria-pressed={sides === dieSides}
                title={diceLabels[dieSides]}
              >
                <span className="die-glyph" aria-hidden="true">◇</span>
                <strong>d{dieSides}</strong>
              </button>
            ))}
          </div>
          <div className="die-caption">d{sides} · {diceLabels[sides]}</div>

          <div className="dice-options">
            <label className="dice-option-field">
              <span>Number of dice</span>
              <div className="number-control">
                <button type="button" aria-label="Remove one die" onClick={() => setCount(String(Math.max(1, (Number(diceCount) || 1) - 1)))} disabled={countValue <= 1}>−</button>
                <input aria-label="Number of dice" type="number" min="1" max="20" step="1" value={diceCount} onChange={(event) => setCount(event.target.value)} />
                <button type="button" aria-label="Add one die" onClick={() => setCount(String(Math.min(20, (Number(diceCount) || 0) + 1)))} disabled={countValue >= 20}>＋</button>
              </div>
            </label>
            <label className="dice-option-field">
              <span>Modifier</span>
              <div className="modifier-input-wrap"><span aria-hidden="true">±</span><input aria-label="Roll modifier" type="number" min="-1000" max="1000" step="1" value={modifier} onChange={(event) => setModifier(event.target.value)} /></div>
            </label>
          </div>

          <label className="dice-option-field mode-field">
            <span>Roll mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as RollMode)}>
              <option value="normal">Normal</option>
              <option value="advantage" disabled={!canUseD20Modes}>Advantage</option>
              <option value="disadvantage" disabled={!canUseD20Modes}>Disadvantage</option>
            </select>
          </label>
          {!canUseD20Modes && <p className="mode-help">Advantage and Disadvantage are available only for one d20.</p>}

          {error && <div className="dice-error" role="alert">{error}</div>}
          <button type="button" className="roll-button" onClick={roll}><span className="roll-button-icon">⚄</span>Roll the Dice<span className="roll-button-arrow">↗</span></button>
          <p className="fairness-note"><span>✦</span> Rolls use your device’s secure random number generator.</p>
        </div>

        <div className="dice-results-column">
          <section className="dice-panel current-roll-panel" aria-live="polite" aria-label="Latest dice result">
            <div className="dice-panel-heading"><div className="eyebrow small"><span className="eyebrow-line" />THE RESULT</div>{lastResult && <span className="result-expression">{lastResult.mode === 'normal' ? `${lastResult.diceCount}d${lastResult.sides} · Normal` : `d20 · ${lastResult.mode}`}</span>}</div>
            {lastResult ? (
              <>
                <div className="result-total">{lastResult.total}</div>
                <div className="result-total-label">FINAL TOTAL</div>
                <div className="rolled-dice" aria-label="Individual die results">
                  {lastResult.diceResults.map((value, index) => {
                    const kept = lastResult.keptIndices.includes(index)
                    return <div className={`rolled-die${kept ? ' kept' : ' dropped'}`} key={`${index}-${value}`}><span>d{lastResult.sides}</span><strong>{value}</strong>{lastResult.mode !== 'normal' && <small>{kept ? 'KEPT' : 'SET ASIDE'}</small>}</div>
                  })}
                </div>
                <p className="result-breakdown">{lastResult.breakdown}</p>
              </>
            ) : (
              <div className="result-placeholder"><span aria-hidden="true">✧</span><h3>The table is waiting</h3><p>Your roll and its breakdown will appear here.</p></div>
            )}
          </section>

          <section className="dice-panel history-panel" aria-labelledby="history-heading">
            <div className="history-heading-row"><div><div className="eyebrow small"><span className="eyebrow-line" />RECENT FATE</div><h2 id="history-heading">Roll History</h2></div><button className="clear-history-button" onClick={() => setHistory([])} disabled={history.length === 0}>Clear history</button></div>
            {history.length === 0 ? (
              <p className="history-empty">Your last 20 rolls will be kept for this session.</p>
            ) : (
              <ol className="history-list">
                {history.map((entry) => (
                  <li className="history-entry" key={entry.id}>
                    <span className="history-time">{entry.rolledAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    <div className="history-detail"><strong>{entry.result.mode === 'normal' ? `${entry.result.diceCount}d${entry.result.sides} · Normal` : `d20 · ${entry.result.mode}`}</strong><span>{entry.result.breakdown}</span></div>
                    <strong className="history-total">{entry.result.total}</strong>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}

export default DiceRoller
