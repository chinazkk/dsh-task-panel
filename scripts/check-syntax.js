// ─────────────────────────────────────────────────────────────
// check-syntax.js · 校验 src/host.js 与 src/client.js 的语法
// 运行：npm run check（或 node scripts/check-syntax.js）
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let failed = false

for (const rel of ['src/host.js', 'src/client.js']) {
  const code = readFileSync(join(root, rel), 'utf8')
  try {
    // 与 DSH 动态插件沙箱一致：代码作为 async 函数体求值
    new Function('return (async () => {\n' + code + '\n})')
    console.log('✅', rel, `语法 OK（${code.length} 字节）`)
  } catch (e) {
    failed = true
    console.error('❌', rel, '语法错误:', e.message)
  }
}

if (failed) process.exit(1)
console.log('✔ 全部源文件语法校验通过')
