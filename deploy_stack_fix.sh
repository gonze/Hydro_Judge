#!/bin/bash
# ============================================================
# Hydro_Judge 栈限制部署脚本
# 用途：部署修改后的文件到 Linux 服务器
#       并重启 Hydro_Judge 服务
# ============================================================

set -e

# 配置路径（请根据实际安装路径修改）
HYDRO_JUDGE_DIR="${HYDRO_JUDGE_DIR:-/opt/oj/Hydro_Judge}"
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

# 需要部署的文件列表
FILES=(
    "judge/config.js"
    "judge/server.js"
    "judge/sandbox.js"
    "judge/sandbox_win.js"
)

# 检查本地文件是否存在
for file in "${FILES[@]}"; do
    if [ ! -f "$LOCAL_HYDRO_DIR/$file" ]; then
        echo "警告: 找不到本地 $file 文件，跳过"
    fi
done

echo "[步骤 1] 备份远程服务器上的原文件..."
BACKUP_DIR="$HYDRO_JUDGE_DIR/backup/$(date +%Y%m%d_%H%M%S)"
ssh $REMOTE_USER@$REMOTE_HOST "mkdir -p '$BACKUP_DIR'"

for file in "${FILES[@]}"; do
    ssh $REMOTE_USER@$REMOTE_HOST "cp '$HYDRO_JUDGE_DIR/$file' '$BACKUP_DIR/' 2>/dev/null || echo '$file 不存在，跳过备份'"
done
echo "备份完成"

echo "[步骤 2] 上传修改后的文件..."
for file in "${FILES[@]}"; do
    if [ -f "$LOCAL_HYDRO_DIR/$file" ]; then
        echo "  上传 $file"
        scp "$LOCAL_HYDRO_DIR/$file" $REMOTE_USER@$REMOTE_HOST:"$HYDRO_JUDGE_DIR/$file"
    fi
done

echo "[步骤 3] 停止所有评测服务..."
ssh $REMOTE_USER@$REMOTE_HOST "cd '$HYDRO_JUDGE_DIR' && bash stop_worker.sh"

echo "[步骤 4] 启动所有评测服务..."
ssh $REMOTE_USER@$REMOTE_HOST "cd '$HYDRO_JUDGE_DIR' && bash start_worker.sh"

echo "[步骤 5] 查看当前栈限制配置..."
ssh $REMOTE_USER@$REMOTE_HOST "
    echo 'config.js 中的栈限制配置:'
    grep -E 'SYSTEM_STACK' '$HYDRO_JUDGE_DIR/judge/config.js' | head -5
    echo
    echo '当前进程栈限制:'
    PID=\$(pgrep -f 'judge/server.js' | head -1)
    if [ -n \"\$PID\" ]; then
        cat /proc/\$PID/limits 2>/dev/null | grep -i stack || echo '无法获取进程限制'
    else
        echo '找不到 Hydro_Judge 进程'
    fi
"

echo "=============================================="
echo "部署完成！"
echo "=============================================="
echo ""
echo "后续验证步骤："
echo "  1. 提交一个 getrlimit 测试代码验证栈限制"
echo "  2. 检查 Hydro_Judge 日志: $HYDRO_JUDGE_DIR/judge.log"
echo "  3. 访问 http://localhost:5000/status 查看服务状态"
echo ""
