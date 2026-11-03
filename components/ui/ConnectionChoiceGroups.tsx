'use client'

export interface ConnectionChoiceGroup {
  tone?: 'green' | 'purple' | 'teal' | 'blue' | 'orange' | 'rose'
  title: string
  description: string
  choices: Array<{ id: string; name: string; note: string; tone?: ConnectionChoiceGroup['tone'] }>
}

export default function ConnectionChoiceGroups({ groups, value, onChange, disabled }: { groups: ConnectionChoiceGroup[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const choices = groups.flatMap(group => group.choices)
  const focusId = choices.some(choice => choice.id === value) ? value : choices[0]?.id
  return <div className="connection-choice-groups" role="radiogroup" aria-label="文字接入方式" onKeyDown={event => {
    if (disabled || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]'))
    const current = buttons.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (current + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + choices.length) % choices.length
    onChange(choices[next].id)
    buttons[next]?.focus()
  }}>
    {groups.map(group => <section className="connection-choice-group" data-tone={group.tone || 'green'} key={group.title}>
      <div className="connection-group-heading"><strong>{group.title}</strong><p>{group.description}</p></div>
      <div className="connection-choice-grid">{group.choices.map(choice => <button type="button" role="radio" data-tone={choice.tone || group.tone || 'green'} aria-checked={value === choice.id} tabIndex={choice.id === focusId ? 0 : -1} disabled={disabled} className={`connection-choice${value === choice.id ? ' is-selected' : ''}`} key={choice.id} onClick={() => onChange(choice.id)}>
        <span className="connection-choice-indicator" aria-hidden="true">{value === choice.id ? '✓' : ''}</span><span><strong>{choice.name}</strong><small>{choice.note}</small></span>
      </button>)}</div>
    </section>)}
  </div>
}
