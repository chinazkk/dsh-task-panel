// ─────────────────────────────────────────────────────────────
// check-deps.js · 依赖审计（整理该插件需要的依赖）
// 校验：
//   1) 仓库内所有 import/require 的外部说明符都必须声明在 package.json
//      （dependencies / peerDependencies / devDependencies）中；
//   2) node: 内置模块与相对路径不在此列；
//   3) package.json 的 scripts 引用的脚本文件必须存在；
//   4) 输出插件消费的 Host 服务清单（inject / ctx.get / ctx 直读属性），
//      这些服务由宿主 @deepseek-ai/dsh 提供、不随仓库打包。
// 运行：npm run check:deps（或 node scripts/check-deps.js）
// 退出码：0 通过；1 存在未声明依赖或引用缺失。
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Node 内置模块（无 node: 前缀时也按内置处理，不算外部依赖）
const BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
  'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
])

// 参与审计的源码文件（scripts/ 目录下其余 .js 会自动加入）
const CORE_FILES = ['src/host.js', 'src/client.js', 'test/simulate-host.js', 'scripts/check-syntax.js']

function collectFiles() {
  const files = []
  const push = (rel) => {
    const p = join(root, rel)
    if (existsSync(p)) files.push({ rel, code: readFileSync(p, 'utf8') })
  }
  for (const rel of CORE_FILES) push(rel)
  const scriptsDir = join(root, 'scripts')
  if (existsSync(scriptsDir)) {
    for (const name of readdirSync(scriptsDir)) {
      if (!name.endsWith('.js')) continue
      const rel = 'scripts/' + name
      if (!files.some((x) => x.rel === rel)) push(rel)
    }
  }
  return files
}

// 提取 import / require / export-from 的模块说明符
function extractSpecifiers(code) {
  const out = new Set()
  const reImport = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
  const reRequire = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  const reExport = /export\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
  for (const re of [reImport, reRequire, reExport]) {
    let m
    while ((m = re.exec(code)) !== null) out.add(m[1])
  }
  return [...out]
}

// 说明符分类：relative / builtin / external
function classify(spec) {
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) return 'relative'
  if (spec.startsWith('node:')) return 'builtin'
  const base = spec.split('/')[0]
  if (BUILTINS.has(base)) return 'builtin'
  return 'external'
}

// 提取 Host 服务：inject 声明 + ctx.get('...') + ctx 直读属性（subagents/agents/timer）
function extractHostServices(code) {
  const services = new Set()
  const reInject = /inject\s*:\s*\[([^\]]*)\]/g
  let m
  while ((m = reInject.exec(code)) !== null) {
    for (const raw of m[1].split(',')) {
      const s = raw.trim().replace(/^['"]|['"]$/g, '').trim()
      if (s) services.add(s)
    }
  }
  const reGet = /ctx\.get\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = reGet.exec(code)) !== null) services.add(m[1])
  const reProp = /\bctx\.(subagents|agents|timer|skills)\b/g
  while ((m = reProp.exec(code)) !== null) services.add(m[1])
  return [...services].sort()
}

let failed = false

// 1) 外部说明符必须声明在 package.json
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
])

const used = []
const seen = new Set()
for (const { rel, code } of collectFiles()) {
  for (const spec of extractSpecifiers(code)) {
    if (classify(spec) !== 'external') continue
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    const key = rel + '::' + spec
    if (seen.has(key)) continue
    seen.add(key)
    used.push({ rel, spec, name })
  }
}

for (const u of used) {
  if (!declared.has(u.name)) {
    failed = true
    console.error('❌ 未声明的外部依赖:', u.rel, '→', u.spec, '（请添加到 package.json 的 dependencies/peerDependencies/devDependencies）')
  }
}
if (!failed) console.log('✅ 全部 import/require 外部说明符均已声明（未发现未声明的第三方依赖）')

// 2) package.json scripts 引用的脚本文件必须存在
for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
  const m = String(cmd).match(/node\s+([^\s&|]+)/)
  if (m && !existsSync(join(root, m[1]))) {
    failed = true
    console.error('❌ package.json 脚本', name, '引用的文件不存在:', m[1])
  }
}

// 3) Host 服务依赖报告（运行期由宿主注入，不随仓库打包）
const hostCode = readFileSync(join(root, 'src/host.js'), 'utf8')
const clientCode = readFileSync(join(root, 'src/client.js'), 'utf8')
console.log('\n── Host 服务依赖（运行期由 @deepseek-ai/dsh 注入，不随仓库打包）──')
console.log('Host  消费:', extractHostServices(hostCode).join(', ') || '（无）')
console.log('Client 消费:', extractHostServices(clientCode).join(', ') || '（无）')
console.log('npm 声明:', ['dependencies', 'peerDependencies', 'devDependencies']
  .filter((k) => pkg[k] && Object.keys(pkg[k]).length)
  .map((k) => k + '={' + Object.keys(pkg[k]).join(', ') + '}')
  .join('  ') || '（仅 peerDependencies 由宿主提供，无打包依赖）')

if (failed) {
  console.error('\n❌ 依赖审计未通过')
  process.exit(1)
}
console.log('\n✔ 依赖审计通过')
