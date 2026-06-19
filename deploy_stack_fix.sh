#!/bin/bash
# ============================================================
# Hydro_Judge 栈限制部署脚本
# 用途：部署修改后的 config.js 和 sandbox.js 到 Linux 服务器
#       并重启 Hydro_Judge 服务
# ============================================================

set -e

# 配置路径（请根据实际安装路径修改）
HYDRO_JUDGE_DIR="${HYDRO_JUDGE_DIR:-$HOME/Hydro_Judge}"
REMOTE_HOST="${REMOTE_HOST:-192.168.110.198}"
REMOTE_USER="${REMOTE_USER:-sloj}"

# 本地文件路径（在 Windows 开发机上）
LOCAL_HYDRO_DIR="${LOCAL_HYDRO_DIR:-d:/new/OJ-new/Hydro_Judge}"

echo "=============================================="
echo "Hydro_Judge 栈限制部署脚本"
echo "=============================================="
echo "本地源目录: $LOCAL_HYDRO_DIR"
echo "远程主机: $REMOTE_USER@$REMOTE_HOST"
echo "远程安装目录: $HYDRO_JUDGE_DIR"
echo "=============================================="

# 检查本地文件是否存在
if [ ! -f "$LOCAL_HYDRO_DIR/judge/config.js" ]; then
    echo "错误: 找不到本地 config.js 文件"
    echo "  路径: $LOCAL_HYDRO_DIR/judge/config.js"
    exit 1
fi

if [ ! -f "$LOCAL_HYDRO_DIR/judge/sandbox.js" ]; then
    echo "错误: 找不到本地 sandbox.js 文件"
    echo "  路径: $LOCAL_HYDRO_DIR/judge/sandbox.js"
    exit 1
fi

echo "[步骤 1] 备份远程服务器上的原文件..."
ssh $REMOTE_USER@$REMOTE_HOST "
    mkdir -p '$HYDRO_JUDGE_DIR/backup/$(date +%Y%m%d_%H%M%S)'
    cp '$HYDRO_JUDGE_DIR/judge/config.js' '$HYDRO_JUDGE_DIR/backup/' 2>/dev/null || echo 'config.js 不存在，跳过备份'
    cp '$HYDRO_JUDGE_DIR/judge/sandbox.js' '$HYDRO_JUDGE_DIR/backup/' 2>/dev/null || echo 'sandbox.js 不存在，跳过备份'
    echo '备份完成'
"

echo "[步骤 2] 上传修改后的文件..."
scp "$LOCAL_HYDRO_DIR/judge/config.js" $REMOTE_USER@$REMOTE_HOST:"$HYDRO_JUDGE_DIR/judge/config.js"
scp "$LOCAL_HYDRO_DIR/judge/sandbox.js" $REMOTE_USER@$REMOTE_HOST:"$HYDRO_JUDGE_DIR/judge/sandbox.js"

echo "[步骤 3] 停止当前 Hydro_Judge 服务..."
ssh $REMOTE_USER@$REMOTE_HOST "
    pkill -f 'judge/server.js' 2>/dev/null || true
    sleep 1
    echo '服务已停止'
"

echo "[步骤 4] 启动 Hydro_Judge 服务（含无栈限制配置）..."
ssh $REMOTE_USER@$REMOTE_HOST "
    cd '$HYDRO_JUDGE_DIR'
    ulimit -s unlimited
    JUDGE_PORT=5000 JUDGE_TOKEN='your-long-random-token' nohup node judge/server.js > judge.log 2>&1 &
    sleep 2
    echo '服务已启动，进程 ID:'
    pgrep -f 'judge/server.js'
"

echo "[步骤 5] 验证服务状态..."
sleep 3
ssh $REMOTE_USER@$REMOTE_HOST "
    curl -s http://localhost:5000/status 2>/dev/null || echo '服务未就绪'
"

echo "[步骤 6] 查看当前配置..."
ssh $REMOTE_USER@$REMOTE_HOST "
    echo 'config.js 中的栈限制配置:'
    grep 'SYSTEM_STACK_LIMIT' '$HYDRO_JUDGE_DIR/judge/config.js'
    echo
    echo 'sandbox.js 中的 stackLimit 传递:'
    grep 'stackLimit' '$HYDRO_JUDGE_DIR/judge/sandbox.js'
    echo
    echo '当前进程栈限制:'
    PID=\$(pgrep -f 'judge/server.js')
    if [ -n \"\$PID\" ]; then
        cat /proc/\$PID/limits 2>/dev/null | grep -i stack || echo '无法获取进程限制（可能需要 root 权限）'
    fi
"

echo "=============================================="
echo "部署完成！"
echo "=============================================="
echo ""
echo "后续验证步骤："
echo "  1. 提交一个需要大栈空间的 C++ 代码测试"
echo "  2. 检查 Hydro_Judge 日志: $HYDRO_JUDGE_DIR/judge.log"
echo "  3. 访问 http://localhost:5000/status 查看服务状态"
echo ""
