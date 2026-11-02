import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { buildSpatialHtml } from './export'
import { createSpatialProject } from './spec'

const runtime = readFileSync(new URL('../../public/spatial/runtime.js', import.meta.url), 'utf8')

describe('standalone spatial export', () => {
  it('embeds the real runtime and the complete project with no external scripts', () => {
    const p = createSpatialProject('森林')
    const html = buildSpatialHtml(p, runtime)
    expect(html).toContain('PIXEL_WORLD_SPATIAL_RUNTIME_V1')
    expect(html).toContain('immersive-vr')
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toContain('apiKey')
    expect(() => new Script(runtime)).not.toThrow()
    const data = html.match(/id="spatial-project" type="application\/json">([^<]+)<\/script>/)![1]
    expect(JSON.parse(data)).toEqual(p)
  })

  it('prevents text from escaping JSON or the HTML title', () => {
    const p = { ...createSpatialProject('forest'), title: '</title><script>alert(1)</script>', brief: '</script><img src=x onerror=alert(1)>' }
    const html = buildSpatialHtml(p, runtime)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain('&lt;/title&gt;')
  })

  it('refuses to export if the player resource did not load', () => {
    expect(() => buildSpatialHtml(createSpatialProject('forest'), '<html>404</html>')).toThrow('运行资源')
  })
})
