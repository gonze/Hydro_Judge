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
chmod +x build_go_judge_image.sh install_ubuntu.sh start_worker.sh update_worker.sh

# Optional but recommended when using go-judge:
# build a local go-judge image that includes gcc/g++/python3.
./build_go_judge_image.sh

./install_ubuntu.sh
./start_worker.sh
```

The install script will:

- install system dependencies: Node.js, npm, gcc/g++, Python, Docker
- install npm dependencies
- create `/var/oj/judge-data`
- write and enable the `hydro-judge-worker` systemd service

The go-judge image script will:

- install and start Docker if it is missing
- build `local/go-judge:cpp-python` from `criyle/go-judge:latest`
- install `gcc`, `g++`, `python3`, `python3-pip`, `libc6-dev`, and `make`
- verify the compiler toolchain inside the image
- write these settings to `.env`:
  - `EXECUTION_HOST=http://127.0.0.1:5050`
  - `GO_JUDGE_IMAGE=local/go-judge:cpp-python`

Run `./build_go_judge_image.sh` before `./install_ubuntu.sh` if you want
Hydro_Judge to use the go-judge backend. If you prefer the simpler host-local
backend, skip this script and keep `EXECUTION_HOST=local`.

The start script will:

- use the local execution backend by default
- recreate the local go-judge container when `EXECUTION_HOST` points to it
- mount `JUDGE_DATA_DIR` and `FILES_DIR` into the go-judge container
- restart the `hydro-judge-worker` service
- health check `http://127.0.0.1:5000/status`
- print the `Hydro_Judge 地址` and `Token` that should be copied into getcode

The update script will:

- stop the `hydro-judge-worker` service
- pull the latest code from GitHub
- refresh the systemd service file
- restart the worker and run a health check
- print the current worker address and token after restart

By default, update does not reinstall npm dependencies. If `package.json` or
`package-lock.json` changed, run:

```bash
UPDATE_DEPS=1 ./update_worker.sh
```

### Configuration

The scripts create `./.env` automatically on first run. If `JUDGE_TOKEN` is not
provided, a random token is generated and stored there. The same token is reused
after reboot or service restart.

View the generated token:

```bash
grep '^JUDGE_TOKEN=' .env
```

Both scripts also accept environment variables:

```bash
JUDGE_PORT=5000
JUDGE_TOKEN="auto-generated-if-empty"
JUDGE_DATA_DIR="/var/oj/judge-data"
SERVICE_NAME="hydro-judge-worker"
EXECUTION_HOST="local"
```

`EXECUTION_HOST=local` uses gcc/g++/python3 installed on the Ubuntu host. To use
an external go-judge service instead, set `EXECUTION_HOST=http://localhost:5050`.
For the bundled local go-judge container, build the custom image first:

```bash
./build_go_judge_image.sh
./install_ubuntu.sh
./start_worker.sh
```

`start_worker.sh` mounts the same data paths into the go-judge container, so
test data and `testlib.h` can be read inside the sandbox:

- `JUDGE_DATA_DIR`, default `/var/oj/judge-data`
- `FILES_DIR`, default `/var/oj/files/judge`

Useful options:

```bash
# Custom output image name
GO_JUDGE_IMAGE=local/go-judge:cpp-python ./build_go_judge_image.sh

# Include Java 17 as well
INSTALL_JAVA=1 ./build_go_judge_image.sh
```

To manually set or rotate the token:

```bash
JUDGE_TOKEN="your-long-random-token" ./start_worker.sh
```

Update from GitHub and restart:

```bash
./update_worker.sh
```

If the server has local uncommitted changes, the update script stops. To force
the update after you have confirmed those changes are disposable:

```bash
FORCE=1 ./update_worker.sh
```

### Connect getcode

On the Windows `getcode` machine:

Open `题目配置 -> 评测服务配置`, set:

- `Hydro_Judge 地址`: `http://<ubuntu-judge-ip>:5000`
- `Token`: the value from `grep '^JUDGE_TOKEN=' .env`

Then click `保存并测试`.

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
