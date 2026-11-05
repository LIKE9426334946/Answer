# Answer

一个个人使用的问答学习网页。电脑端负责管理、编写，手机端负责阅读和主动回忆。

- **目录 → 学习项目 → 多组问答**：项目顶部显示统一的问题描述。
- 目录支持新增、重命名、删除；项目支持新增、修改、删除、切换所属目录。
- 每个项目可添加多组问答，支持上移、下移和删除，保存后顺序同步到学习页。
- 手机端默认隐藏所有答案，点击「查看答案」展开，再次点击收起。
- 项目描述、问题和答案支持 `$...$` 行内 LaTeX，也支持 `$$...$$` 独立公式。
- 管理页提供实时学习预览；支持 `Ctrl+S` / `Cmd+S` 保存，未保存就离开时提醒。
- 当前目录内可搜索项目名称、描述及问题。学习页没有管理入口，电脑端顶部可切换管理。
- 数据存储为服务器 `data/content.json`，手机和电脑共享。刷新页面不会丢失已保存内容。
- 本地提供 KaTeX 脚本、样式和字体，浏览器不依赖外部 CDN。
- 按个人使用方案，不使用数据库、登录或用户权限系统。`/admin` 是管理地址，不是权限隔离；能访问服务的人也能访问管理功能。

### 页面预览

以下为浏览器验证时录入的演示内容；首次安装的数据为空。

![Answer 学习页面](docs/answer-study-20261105.jpg)

## 访问地址与端口

| 用途 | 地址 |
| --- | --- |
| 手机学习 / 电脑查看 | `http://服务器IP:16001/` |
| 电脑内容管理 | `http://服务器IP:16001/admin` |
| Node.js 内部监听 | `127.0.0.1:3001` |
| 安装路径 | `/opt/Answer` |

Nginx 监听公网 16001，并转发至 Node.js 的 3001。生产环境不要将 Node.js 绑定到 `0.0.0.0`，也无需开放 3001。

## 使用方法

1. 在电脑上打开 `/admin`，创建目录，例如「线性代数」。
2. 进入目录，点击「新建项目」，填写项目名称和问题描述（描述可以留空）。
3. 填写第一组问题与答案，点击「添加一组问答」继续添加。每个项目需要至少一组完整问答。
4. 在右侧预览中查看公式和展开效果，点击「保存项目」。
5. 手机打开首页，进入目录和项目。先回忆答案，再点击展开。

电脑修改并保存后，手机刷新页面即可读取最新内容。管理页的实时预览不等于自动保存。

### LaTeX 示例

以下文字可以直接写入描述、问题或答案中：

```text
若 $x = (x_1, x_2, x_3)$，它的均值是 $\mu = \frac{x_1+x_2+x_3}{3}$。

均方误差：
$$L = \frac{1}{n}\sum_{i=1}^{n}(y_i-\hat y_i)^2$$

链式法则：$\frac{\partial L}{\partial x}=\frac{\partial L}{\partial y}\frac{\partial y}{\partial x}$。
```

请使用半角 `$`。普通换行会保留，不需要 HTML。内容按纯文本处理，不执行 HTML 或脚本；不支持的 LaTeX 命令会保留错误原文，便于修改。

## Ubuntu 部署（root 用户）

需要 Node.js **22.12 或更新版本**、npm、Git、Nginx，Node.js 可执行文件位于 `/usr/bin/node`。以下命令均由 root 执行，不需要 sudo。

### 1. 检查环境，下载项目

```bash
node --version
npm --version
apt-get update
apt-get install -y git nginx
mkdir -p /opt/Answer
git clone --branch main https://github.com/LIKE9426334946/Answer.git /opt/Answer
cd /opt/Answer
npm ci --omit=dev
npm run check
```

`/opt/Answer` 应为空目录；已有克隆请使用下方「更新项目」。若尚未安装 Node.js，请先安装符合版本要求的 Node.js，再继续。此项目不需要前端构建步骤。

### 2. 创建 systemd 服务

仓库中已提供完整文件 `deploy/Answer.service`：

```bash
cp /opt/Answer/deploy/Answer.service /etc/systemd/system/Answer.service
systemctl daemon-reload
systemctl enable Answer
systemctl start Answer
systemctl --no-pager status Answer
```

该服务使用 `User=root`、`WorkingDirectory=/opt/Answer`，启动入口为 `/usr/bin/node /opt/Answer/backend/server.js`，配置 `NODE_ENV=production`、`HOST=127.0.0.1`、`PORT=3001`，异常退出自动重启。

### 3. 创建并启用 Nginx 配置

```bash
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
cp /opt/Answer/deploy/Answer.nginx.conf /etc/nginx/sites-available/Answer
ln -sfn /etc/nginx/sites-available/Answer /etc/nginx/sites-enabled/Answer
nginx -t
systemctl enable nginx
systemctl start nginx
systemctl reload nginx
```

配置包含独立 `server`、16001 监听端口、反向代理头及 WebSocket 升级头，不使用域名。它通过 Ubuntu 默认 `nginx.conf` 中 `http` 块内的 `sites-enabled/*` 引入。

### 4. 检查并访问

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:16001/api/health
journalctl -u Answer -n 50 --no-pager
```

正常返回 `{"ok":true,"app":"Answer"}`。在云服务器安全组中放行 TCP **16001**；如果启用了 UFW，再执行 `ufw allow 16001/tcp`。无需开放内部 3001。

访问 `http://服务器IP:16001/` 和 `http://服务器IP:16001/admin`。

### 可选：一键安装配置

完成环境安装、克隆后，也可以用以下脚本替代上面的依赖安装、systemd、Nginx 配置步骤：

```bash
cd /opt/Answer
bash deploy/install.sh
```

脚本仅安装 Answer 自己的服务和站点配置，不修改其他项目配置。它不会修改安全组或自动开放防火墙端口。

## 更新项目

```bash
cd /opt/Answer
git pull --ff-only origin main
npm ci --omit=dev
npm run check
systemctl restart Answer
systemctl --no-pager status Answer
```

如部署配置有变化，再复制对应文件并执行 `systemctl daemon-reload` 或 `nginx -t`、`systemctl reload nginx`。运行数据目录被 Git 忽略，拉取代码不会覆盖已保存的目录、项目和问答。

## 数据与备份

首次启动自动创建空数据文件：`/opt/Answer/data/content.json`。所有学习数据都在 `data/`，备份这个目录即可。仓库不含用户数据或演示数据。

```bash
tar -czf /root/Answer-data-$(date +%F-%H%M%S).tar.gz -C /opt/Answer data
```

恢复时先停止服务，将备份中的 `data/` 放回 `/opt/Answer/data/`，再 `systemctl start Answer`。

写入采用同目录临时文件、同步写入和原子替换。多次写请求串行执行，并检查内容版本：多个管理页面同时编辑时，旧版本会拒绝保存并保留当前输入，避免覆盖其他页面的修改。发生冲突时，先复制当前编辑内容，再刷新重试。请只运行一个 Answer Node.js 进程，不使用 cluster / 多进程共同写入同一个文件。

如果 JSON 文件损坏，程序会报错停止启动，不会自动清空或覆盖文件；请检查日志并恢复有效备份。

## 本地运行与验证

```bash
npm ci
npm run check
npm test
npm start
```

打开 `http://127.0.0.1:3001/` 和 `http://127.0.0.1:3001/admin`。环境变量 `HOST`、`PORT`、`DATA_DIR` 可用于本地测试；生产服务已固定为要求的地址和端口。自动测试使用临时目录，不修改真实数据。

测试覆盖目录和项目增删改、问答顺序、LaTeX 文本保存、重启后读取、并发冲突、错误输入、跨站写入限制，以及静态页面和本地公式资源。
