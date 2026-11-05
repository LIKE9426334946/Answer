#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 root 用户执行。" >&2
    exit 1
fi
answer_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [ "$answer_root" != /opt/Answer ]; then
    echo "请先将项目放到 /opt/Answer，再执行 bash deploy/install.sh。" >&2
    exit 1
fi
if [ ! -x /usr/bin/node ]; then
    echo "请安装 Node.js 22.12 或更新版本，确保 /usr/bin/node 存在。" >&2
    exit 1
fi
/usr/bin/node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("需要 Node.js 22.12 或更新版本。"); process.exit(1); }'
command -v npm >/dev/null
command -v nginx >/dev/null
command -v systemctl >/dev/null
cd "$answer_root"
npm ci --omit=dev --no-audit --no-fund
npm run check
mkdir -p data /etc/nginx/sites-available /etc/nginx/sites-enabled
install -m 644 deploy/Answer.service /etc/systemd/system/Answer.service
install -m 644 deploy/Answer.nginx.conf /etc/nginx/sites-available/Answer
ln -sfn /etc/nginx/sites-available/Answer /etc/nginx/sites-enabled/Answer
nginx -t
systemctl daemon-reload
systemctl enable Answer nginx
systemctl restart Answer
systemctl start nginx
systemctl reload nginx
systemctl --no-pager status Answer
echo 'Answer 已启动：学习页面 http://服务器IP:16001/，管理页面 http://服务器IP:16001/admin'
