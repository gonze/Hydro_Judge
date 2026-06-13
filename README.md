# Hydro_Judge

高效的信息学算法竞赛评测后端，支持子任务、自定义比较器和交互题。可运行 HTTP Worker 模式，作为 `getcode` 的局域网评测服务。

> 移植自 [hydro-dev/HydroJudge](https://github.com/hydro-dev/HydroJudge)，基于原项目二次开发，主要增加了 HTTP Worker 模式并适配 Windows + Ubuntu 混合部署场景。

## 项目结构

```
Hydro_Judge/
├── judge/
│   ├── server.js            # HTTP Worker 入口（getcode 评测模式）
│   ├── daemon.js            # 经典守护进程入口（轮询模式）
│   ├── entrypoint.js        # CLI 入口
│   ├── config.js            # 全局配置管理
│   ├── compile.js           # 代码编译引擎
│   ├── sandbox.js           # go-judge 沙箱桥接
│   ├── check.js             # 比较器调度
│   ├── cases.js             # 测试用例读取
│   │
│   ├── judge/               # 评测引擎
│   │   ├── default.js       # 标准评测（多测试点 + 子任务）
│   │   ├── interactive.js   # 交互题评测
│   │   ├── submit_answer.js # 提交答案评测
│   │   ├── remotejudge.js   # 远程 OJ 评测
│   │   └── run.js           # 单次运行评测
│   │
│   ├── checkers/            # 比较器实现
│   │   ├── default.js       # 严格文本对比
│   │   ├── testlib.js       # Testlib 比较器
│   │   ├── hustoj.js        # HUSTOJ 风格
│   │   └── ...
│   │
│   └── case/                # 测试数据格式
│       ├── yaml.js           # config.yaml（现代格式）
│       ├── conf.js           # problem.conf
│       └── auto.js           # 自动识别
│
├── build_go_judge_image.sh  # 构建自定义 go-judge 镜像
├── install_ubuntu.sh         # Ubuntu 一键安装脚本
├── start_worker.sh           # 启动 Worker 服务
├── update_worker.sh          # Git 更新并重启
├── examples/                 # 配置示例
│   ├── testdata.yaml         # 测试数据配置示例
│   ├── judge.yaml            # 评测机配置示例
│   ├── langs.yaml            # 语言定义（Linux）
│   └── testlib.h             # Testlib 头文件
└── package.json
```

## 评测功能

### 支持的评测类型

| 类型 | 说明 |
|------|------|
| `default` | 标准多测试点评测，支持子任务、计分策略、模板注入、并发执行 |
| `interactive` | 交互题评测，用户程序与交互器通过管道通信 |
| `submit_answer` | 提交答案评测，直接对比输出，无需编译运行 |
| `remotejudge` | 代理提交到远程 OJ 平台 |
| `run` | 单次运行模式（适用于 IDE/测试） |

### 支持的比较器

| 比较器 | 说明 |
|--------|------|
| `default` | 严格文本对比（忽略行末空格） |
| `testlib` | Testlib 比较器（自动提供 `testlib.h`） |
| `hustoj` | HUSTOJ 风格比较器 |
| `lemon` | Lemon/Cena 风格比较器 |
| `qduoj` | QDUOJ 风格比较器 |
| `syzoj` | SYZOJ 风格比较器 |

### 执行后端

- **go-judge（Linux）**：`criyle/go-judge` 容器化沙箱，提供进程隔离和资源限制
- **本地执行**：直接调用系统编译器/解释器（Windows 或 `EXECUTION_HOST=local`）

## HTTP Worker 模式（推荐，用于 getcode）

启动 HTTP 评测服务，通过 REST API 接收评测任务：

| 端点 | 说明 |
|------|------|
| `POST /judge/submit` | 提交评测任务 |
| `GET /judge/status?rid=xxx` | 查询任务状态与结果 |
| `POST /data/upload` | 上传测试数据 |
| `GET /data/files?data_id=xxx` | 查看测试数据文件 |
| `GET /status` | Worker 运行状态 |
| `GET /test` | 连通性检查 |

### 认证

所有 API 请求需携带 Bearer Token：

```
Authorization: Bearer <JUDGE_TOKEN>
```

## 快速部署（Ubuntu）

在干净的 Ubuntu 服务器上执行：

```bash
git clone <仓库地址> Hydro_Judge
cd Hydro_Judge
chmod +x build_go_judge_image.sh install_ubuntu.sh start_worker.sh update_worker.sh

# （推荐）构建包含编译器的自定义 go-judge 镜像
./build_go_judge_image.sh

# 安装系统依赖、npm 包、配置 systemd 服务
./install_ubuntu.sh

# 启动 Worker
./start_worker.sh
```

### 各脚本说明

**build_go_judge_image.sh**：
- 基于 `criyle/go-judge:latest` 构建本地镜像 `local/go-judge:cpp-python`
- 镜像内安装 `gcc`、`g++`、`python3` 及开发库
- 可选安装 Java 17：`INSTALL_JAVA=1 ./build_go_judge_image.sh`

**install_ubuntu.sh**：
- 安装系统依赖：Node.js、npm、gcc/g++、Python3、Docker
- 执行 `npm install` 安装 Node 依赖
- 创建所需目录和 systemd 服务

**start_worker.sh**：
- 自动生成随机 `JUDGE_TOKEN`（首次运行）
- 管理 go-judge 容器生命周期
- 写入并启动 `hydro-judge-worker` 系统服务
- 健康检查 `http://127.0.0.1:5000/status`
- 输出 `Hydro_Judge 地址` 和 `Token` 供 getcode 配置

**update_worker.sh**：
- 停止服务 → `git pull` → 重启服务
- 依赖更新：`UPDATE_DEPS=1 ./update_worker.sh`
- 强制更新：`FORCE=1 ./update_worker.sh`

## 配置说明

脚本自动创建 `.env` 文件保存配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JUDGE_PORT` | `5000` | Worker 监听端口 |
| `JUDGE_TOKEN` | 自动生成 | API 认证密钥 |
| `JUDGE_DATA_DIR` | `/var/oj/judge-data` | 测试数据目录 |
| `SERVICE_NAME` | `hydro-judge-worker` | systemd 服务名 |
| `EXECUTION_HOST` | `local` | 执行后端（`local` 或 `http://127.0.0.1:5050`） |

查看生成的 Token：

```bash
grep '^JUDGE_TOKEN=' .env
```

手动设置/更换 Token：

```bash
JUDGE_TOKEN="your-long-random-token" ./start_worker.sh
```

## 连接 getcode

在 Windows 上的 getcode 管理后台：

1. 打开 **题目配置 → 评测服务配置**
2. 设置 **Hydro_Judge 地址**：`http://<Ubuntu评测机IP>:5000`
3. 填入 **Token**：`grep JUDGE_TOKEN .env` 的输出
4. 点击 **保存并测试**

getcode 会将测试数据上传到 `POST /data/upload`，评测时通过 `data_id` 引用，因此评测机无需访问 Windows 的文件路径。

## 常用命令

```bash
# 查看服务状态
sudo systemctl status hydro-judge-worker --no-pager

# 查看日志
sudo journalctl -u hydro-judge-worker -f

# 查看 Docker 容器
docker ps

# 检查 Worker 健康
curl -H "Authorization: Bearer <token>" http://127.0.0.1:5000/status
```

## 安全提醒

- 不要将 Worker 暴露到公网
- 务必设置 `JUDGE_TOKEN`
- 使用防火墙限制只允许内网访问

## 测试数据格式

测试数据打包为 ZIP 文件，根目录包含 `config.yaml`（无此文件时自动识别）。格式详见 [examples/testdata.yaml](examples/testdata.yaml)。
