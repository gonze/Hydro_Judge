# Moved to [Hydro](https://github.com/hydro-dev/Hydro)

# Judge Daemon

## LAN Remote Judge Worker

This fork can run as a lightweight HTTP judge worker for `getcode`.
Use this mode when `getcode` is deployed on a Windows machine and the actual
compilation / execution is handled by an Ubuntu server in the same LAN.

### Quick Ubuntu Install

On a clean Ubuntu server with `git` installed:

```bash
git clone <your Hydro_Judge repo url> Hydro_Judge
cd Hydro_Judge
chmod +x install_ubuntu.sh start_worker.sh
chmod +x update_worker.sh

JUDGE_TOKEN="change-this-token" ./install_ubuntu.sh
JUDGE_TOKEN="change-this-token" ./start_worker.sh
```

The install script will:

- install system dependencies: Node.js, npm, gcc/g++, Python, Docker
- install npm dependencies
- create `/var/oj/judge-data`
- write and enable the `hydro-judge-worker` systemd service

The start script will:

- start the `criyle/go-judge:latest` Docker container
- restart the `hydro-judge-worker` service
- health check `http://127.0.0.1:5000/status`

The update script will:

- stop the `hydro-judge-worker` service
- pull the latest code from GitHub
- refresh npm dependencies
- refresh the systemd service file
- restart the worker and run a health check

### Configuration

Both scripts accept environment variables:

```bash
JUDGE_PORT=5000
JUDGE_TOKEN="change-this-token"
JUDGE_DATA_DIR="/var/oj/judge-data"
SERVICE_NAME="hydro-judge-worker"
```

For a real LAN deployment, replace the default token:

```bash
JUDGE_TOKEN="your-long-random-token" ./install_ubuntu.sh
JUDGE_TOKEN="your-long-random-token" ./start_worker.sh
```

Update from GitHub and restart:

```bash
JUDGE_TOKEN="your-long-random-token" ./update_worker.sh
```

If the server has local uncommitted changes, the update script stops. To force
the update after you have confirmed those changes are disposable:

```bash
FORCE=1 JUDGE_TOKEN="your-long-random-token" ./update_worker.sh
```

### Connect getcode

On the Windows `getcode` machine:

```powershell
$env:JUDGE_HOST="http://<ubuntu-judge-ip>:5000"
$env:JUDGE_TOKEN="your-long-random-token"
python app.py
```

`getcode` uploads testdata to `POST /data/upload` and stores the returned
`remote_data_id`. During judging it sends `data_id` to `POST /judge/submit`,
so the Ubuntu worker does not need access to Windows local paths.

### Useful Commands

```bash
sudo systemctl status hydro-judge-worker --no-pager
sudo journalctl -u hydro-judge-worker -f
docker ps
curl -H "Authorization: Bearer your-long-random-token" http://127.0.0.1:5000/status
```

Do not expose this worker directly to the public internet. It compiles and runs
submitted code. Use LAN firewall rules and always set `JUDGE_TOKEN`.

[English](docs/en/README.md)

## 介绍
HydroJudge 是一个用于信息学算法竞赛的高效评测后端。  
和之前的版本相比，HydroJudge 支持了自定义比较器、子任务、交互器等多种新特性。  

## 帮助中心

- [RemoteJudge](docs/zh/RemoteJudge.md)

## 安装与使用

前置需求:

- Linux 4.4+
- NodeJS 10+

下载本仓库，并切换到仓库目录。

```sh
npm install -g yarn # 如果已经安装yarn请跳过该步骤
yarn
```

创建设置目录 `~/.config/hydro` ，并放置 `judge.yaml` ，配置文件格式详见 [examples/judge.yaml](examples/judge.yaml)  
启动 [go-sandbox](https://github.com/criyle/go-judge)，监听端口5050。  
您应当以 root 身份运行。  

```sh
node judge/daemon.js
```

## 设置

- 自定义配置文件位置: `--config=/path/to/config` 
- 自定义语言文件位置: `--langs=/path/to/langs`
- 自定义临时目录: `--tmp=/path/to/tmp`
- 自定义缓存目录: `--cache=/path/to/cache`
- 自定义文件目录: `--files=/path/to/files`
- 自定义沙箱地址: `--execute=http://executionhost/`

## 测试数据格式

[测试数据格式](docs/zh/Testdata.md)

在压缩包中添加 config.yaml （无此文件表示自动识别，默认1s, 256MB）。
见 [测试数据格式](examples/testdata.yaml)

为旧版评测机设计的数据包仍然可用。
针对 problem.conf 的兼容性测试仍在进行中。
