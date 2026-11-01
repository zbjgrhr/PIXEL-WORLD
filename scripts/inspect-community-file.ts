import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { inspectCommunityFile } from '../lib/community-file-inspection.server'

async function main() {
  const [input, mime, section, output] = process.argv.slice(2)
  if (!input || !mime || !['workshop','art'].includes(section)) throw new Error('Usage: input mime workshop|art [output]')
  const result = await inspectCommunityFile({ name: basename(input), mime, contents: await readFile(input) }, section as 'workshop' | 'art')
  const text = JSON.stringify({ fileName: basename(input), observedAt: new Date().toISOString(), scope: 'Content inspection only. No game execution, model call, upload, publication or quality certification.', ...result }, null, 2) + '\n'
  if (output) await writeFile(output, text)
  process.stdout.write(text)
}
void main().catch(error => { process.stderr.write(JSON.stringify({ error: 'File inspection failed.', code: typeof error?.code === 'string' ? error.code : 'INSPECTION_FAILED' }) + '\n'); process.exitCode = 1 })
