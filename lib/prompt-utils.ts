/**
 * 从集大成 prompt 中提取指定关卡的描述，用于按关生成更连贯的资源。
 */
export function getLevelSpecificPrompt(fullPrompt: string, levelIndex: number): string {
  const levelNum = levelIndex + 1
  const levelPattern = new RegExp(
    `LEVEL\\s*${levelNum}\\s*[—\\-][\\s\\S]*?(?=LEVEL\\s*${levelNum + 1}\\s*[—\\-]|═══\\s*VISUAL|═══\\s*STORY|$)`,
    'i'
  )
  const match = fullPrompt.match(levelPattern)

  if (match) {
    const globalContext = fullPrompt.split(/LEVEL\s*1\s*[—\-]/i)[0].trim()
    return `${globalContext}\n\n${match[0].trim()}`
  }

  return `${fullPrompt}, level ${levelNum} variation`
}
