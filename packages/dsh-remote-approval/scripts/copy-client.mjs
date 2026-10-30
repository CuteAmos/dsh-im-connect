import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// client.js 已是完整浏览器 bundle（ModuleLoader 工厂），无需 tsc 编译或内联 api-base，
// 这里只做语法校验并复制到 lib/client.js，与 fork 的 lib/ 产物约定保持一致。
const client = readFileSync('client.js', 'utf8').replaceAll('\r\n', '\n')

if (!client.includes('window.__ModuleLoader__.load')) {
  throw new Error('client.js missing window.__ModuleLoader__.load entry')
}

writeFileSync('lib/client.js', client + '\n')

const check = spawnSync(process.execPath, ['--check', 'lib/client.js'], { encoding: 'utf8' })
if (check.status !== 0) {
  throw new Error(check.stderr || check.stdout || 'lib/client.js failed syntax check')
}
console.log('copy-client succeeded!')
