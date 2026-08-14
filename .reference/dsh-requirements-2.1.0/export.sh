#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "2.0.0")
NAME="dsh-requirements-${VERSION}"
OUT="skill-releases/${NAME}.tar.gz"
mkdir -p skill-releases

# 打包进一个顶层同名目录，解压后路径干净、开箱即用
STAGE=$(mktemp -d)
mkdir -p "$STAGE/$NAME"
cp -R cordis.yml package.json export.sh README.md src "$STAGE/$NAME/"

tar -czf "$OUT" -C "$STAGE" "$NAME"
rm -rf "$STAGE"

echo "✅ 已导出：$(pwd)/$OUT"
echo ""
echo "开箱即用安装（任意 DeepSeek Harness / Codex 类 harness）："
echo "  1. 解压：   tar -xzf $(basename "$OUT") -C /path/to/your-harness/plugins"
echo "  2. 构建：   cd /path/to/your-harness/plugins/$NAME && pnpm i && pnpm build"
echo "  3. 挂载：   在宿主 cordis.yml 追加一行"
echo "                 - id: requirements-bundle"
echo "                   name: ./plugins/$NAME/cordis.yml"
echo "  4. 重启 harness → 看到「需求面板」五列看板 + 左侧「任务队列」窗口"
echo ""
echo "校验："
echo "  tar -tzf $OUT | head"
sha256sum "$OUT" 2>/dev/null || shasum -a 256 "$OUT"