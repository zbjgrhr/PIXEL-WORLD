import { describe, expect, it } from 'vitest'
import { sanitizeAgentArtifact, sanitizeSharedArtifacts } from './sanitize'

describe('Agent output sanitization', () => {
  it('keeps only the role whitelist and removes credential-like fields', () => {
    const artifact = sanitizeAgentArtifact('director', {
      title: 'Safe World', playerFantasy: 'Explore', apiKey: 'must-not-survive', executableCode: 'alert(1)',
      constraints: [{ authorization: 'secret', text: 'original art' }],
    })
    expect(artifact.title).toBe('Safe World')
    expect(artifact).not.toHaveProperty('apiKey')
    expect(artifact).not.toHaveProperty('executableCode')
    expect(JSON.stringify(artifact)).not.toContain('secret')
  })

  it('allows only known shared artifact roots', () => {
    const artifacts = sanitizeSharedArtifacts({ narrative: { world: 'safe' }, injected: { command: 'run' }, apiKey: 'hidden' })
    expect(artifacts.narrative).toEqual({ world: 'safe' })
    expect(artifacts).not.toHaveProperty('injected')
    expect(artifacts).not.toHaveProperty('apiKey')
  })
})
