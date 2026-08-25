#!/usr/bin/env node
/**
 * file-tree.js — 列出目录的完整文件树（零第三方依赖，Node ≥ 18）
 *
 * 需求 #RQ-MT7FJT4D-2「给我列出当前文件夹下的所有文件树」的核心实现。
 * 递归遍历目录，输出 ASCII 目录树：目录在前、文件在后（各自按字母序），
 * 文件附带可读大小，符号链接显示为 `name -> target`（不递归，避免环）。
 * 任何条目读取失败只在该节点标注错误并继续，不会中断整个遍历。
 *
 * 用法：
 *   node scripts/file-tree.js [--root <目录>] [--include-git] [--verify]
 *
 *   --root <目录>    要列出的根目录（默认 process.cwd()）
 *   --include-git    同时列出 .git 内部（默认跳过 VCS 元数据）
 *   --verify         自检模式：独立重扫目录并与输出计数核对，不一致时退出码非 0
 *
 * 退出码：0 成功；1 自检失败（仅 --verify）；2 参数错误。
 */
import { readdir, readlink, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

/** 默认跳过的目录名（VCS 元数据；--include-git 打开时移除）。 */
const DEFAULT_EXCLUDED = new Set(['.git'])

/** ── 命令行参数 ────────────────────────────────────────────── */
function parseArgs(argv) {
  const opts = { root: process.cwd(), includeGit: false, verify: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') {
      opts.root = argv[i + 1] ?? process.cwd()
      i += 1
    } else if (arg === '--include-git') {
      opts.includeGit = true
    } else if (arg === '--verify') {
      opts.verify = true
    } else {
      console.error('未知参数：' + arg)
      process.exit(2)
    }
  }
  return opts
}

/** ── 树节点 ────────────────────────────────────────────────── */
/** 目录节点：children 挂子节点，error 记录读目录失败原因（无则 null）。 */
function makeDir(name) {
  return { kind: 'dir', name, children: [], error: null }
}
/** 文件节点：size 为字节数，读取失败时为 null。 */
function makeFile(name, size) {
  return { kind: 'file', name, size }
}
/** 符号链接节点：target 为 readlink 结果。 */
function makeLink(name, target) {
  return { kind: 'link', name, target }
}

/** ── 递归遍历：建树 + 计数 ─────────────────────────────────── */
async function walk(dirPath, node, stats, excluded) {
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch (e) {
    node.error = String(e && e.message ? e.message : e)
    return
  }
  const byName = new Map(entries.map((ent) => [ent.name, ent]))
  // 目录优先、文件在后，各自按字母序
  const names = [...byName.keys()]
    .filter((name) => !(byName.get(name).isDirectory() && excluded.has(name)))
    .sort((a, b) => a.localeCompare(b, 'en'))
  const ordered = [
    ...names.filter((name) => byName.get(name).isDirectory()),
    ...names.filter((name) => !byName.get(name).isDirectory()),
  ]
  for (const name of ordered) {
    const ent = byName.get(name)
    const full = join(dirPath, name)
    if (ent.isDirectory()) {
      stats.dirs += 1
      const child = makeDir(name)
      node.children.push(child)
      await walk(full, child, stats, excluded)
    } else if (ent.isSymbolicLink()) {
      stats.links += 1
      let target = ''
      try {
        target = await readlink(full)
      } catch (e) {
        target = '<unreadable>'
      }
      node.children.push(makeLink(name, target))
    } else {
      stats.files += 1
      let size = null
      try {
        size = (await stat(full)).size
      } catch (e) {
        /* 大小未知不阻塞 */
      }
      node.children.push(makeFile(name, size))
    }
  }
}

/** ── 渲染 ──────────────────────────────────────────────────── */
/** 字节数 → 人类可读（B / KB / MB / GB）。 */
function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return bytes + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024
    unit = units[i]
  }
  return value.toFixed(value >= 10 ? 0 : 1) + ' ' + unit
}

/** 渲染一层子节点；prefix 为祖先分支的缩进前缀。 */
function renderChildren(children, prefix) {
  const lines = []
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    const last = i === children.length - 1
    const branch = last ? '└── ' : '├── '
    const nextPrefix = prefix + (last ? '    ' : '│   ')
    if (child.kind === 'dir') {
      lines.push(prefix + branch + child.name + '/')
      if (child.error) lines.push(nextPrefix + '└── [读取失败: ' + child.error + ']')
      lines.push(...renderChildren(child.children, nextPrefix))
    } else if (child.kind === 'file') {
      const size = child.size === null ? '' : '  (' + formatSize(child.size) + ')'
      lines.push(prefix + branch + child.name + size)
    } else if (child.kind === 'link') {
      lines.push(prefix + branch + child.name + ' -> ' + child.target)
    } else {
      lines.push(prefix + branch + '[错误: ' + child.message + ']')
    }
  }
  return lines
}

/** ── 自检：独立重扫（与 walk 分开的代码路径） ─────────────── */
async function countEntries(dirPath, excluded) {
  const out = { files: 0, dirs: 0, links: 0 }
  async function scan(p) {
    let entries
    try {
      entries = await readdir(p, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (excluded.has(ent.name)) continue
        out.dirs += 1
        await scan(join(p, ent.name))
      } else if (ent.isSymbolicLink()) {
        out.links += 1
      } else {
        out.files += 1
      }
    }
  }
  await scan(dirPath)
  return out
}

/** ── 入口 ──────────────────────────────────────────────────── */
const opts = parseArgs(process.argv.slice(2))
const rootPath = resolve(opts.root)
const excluded = new Set(DEFAULT_EXCLUDED)
if (opts.includeGit) excluded.delete('.git')

const stats = { files: 0, dirs: 0, links: 0 }
const rootNode = makeDir(basename(rootPath) || rootPath)
await walk(rootPath, rootNode, stats, excluded)

const body = renderChildren(rootNode.children, '')
console.log(rootNode.name + '/')
console.log(body.join('\n'))
const total = stats.dirs + stats.files + stats.links
console.log('')
console.log(
  '统计：' + stats.dirs + ' 个目录、' + stats.files + ' 个文件、' + stats.links
    + ' 个符号链接，共 ' + total + ' 项'
    + (opts.includeGit ? '' : '（已排除 .git，可用 --include-git 列出）'),
)

if (opts.verify) {
  const again = await countEntries(rootPath, excluded)
  const checks = [
    ['目录数', stats.dirs, again.dirs],
    ['文件数', stats.files, again.files],
    ['链接数', stats.links, again.links],
  ]
  let ok = true
  for (const [label, tree, rescanned] of checks) {
    const pass = tree === rescanned
    ok = ok && pass
    console.log((pass ? '✓' : '✗') + ' ' + label + '：树 ' + tree + ' vs 独立重扫 ' + rescanned)
  }
  console.log(ok ? '自检通过：独立重扫与输出计数一致。' : '自检失败：计数不一致！')
  process.exit(ok ? 0 : 1)
}
