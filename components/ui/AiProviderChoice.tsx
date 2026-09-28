'use client'

export default function AiProviderChoice({ name, note, color }: { name: string; note: string; color: string }) {
  return <span className="provider-select-option ai-provider-choice">
    <i style={{ background: color, color }} aria-hidden="true" />
    <span>{name}</span>
    <small style={{ color }}>{note}</small>
  </span>
}
