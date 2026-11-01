const fs = require('fs')
const path = require('path')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText, filename)
const { translateUiText } = require('./lib/ui-locale.ts')
const rows = new Map()
function scan(dir) {
  for (const name of fs.readdirSync(dir)) {
    const filename = path.join(dir, name)
    if (fs.statSync(filename).isDirectory()) { scan(filename); continue }
    if (!filename.endsWith('.tsx')) continue
    const tree = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isJsxText(node)) {
        const value = node.text.trim()
        if (/[\u3400-\u9fff]/.test(value)) {
          if (!rows.has(value)) rows.set(value, [])
          rows.get(value).push(filename)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
}
scan('components')
scan('app')
const missing = [...rows].filter(([value]) => !translateUiText(value))
console.log(JSON.stringify({ unique: rows.size, covered: rows.size - missing.length, missing: missing.length }))
for (const [value, files] of missing) console.log(JSON.stringify({ value, file: files[0] }))
