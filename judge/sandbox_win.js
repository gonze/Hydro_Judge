const { execFileSync, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const {
    SYSTEM_MEMORY_LIMIT_MB, SYSTEM_PROCESS_LIMIT, SYSTEM_TIME_LIMIT_MS,
    SYSTEM_STACK_LIMIT_MB,
} = require('./config');
const { SystemError } = require('./error');
const status = require('./status');
const log = require('./log');

const fsp = fs.promises;
const CACHE_DIR = path.join(os.tmpdir(), 'hydrojudge-cache');
fs.ensureDirSync(CACHE_DIR);

const statusMap = {
    'Time Limit Exceeded': status.STATUS_TIME_LIMIT_EXCEEDED,
    'Memory Limit Exceeded': status.STATUS_MEMORY_LIMIT_EXCEEDED,
    'Output Limit Exceeded': status.STATUS_RUNTIME_ERROR,
    Accepted: status.STATUS_ACCEPTED,
    'Nonzero Exit Status': status.STATUS_RUNTIME_ERROR,
    'Internal Error': status.STATUS_SYSTEM_ERROR,
    'File Error': status.STATUS_SYSTEM_ERROR,
    Signalled: status.STATUS_RUNTIME_ERROR,
};

function parseCmd(execute) {
    const parts = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < execute.length; i++) {
        const char = execute[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ' ' && !inQuotes) {
            if (current) {
                parts.push(current);
                current = '';
            }
        } else {
            current += char;
        }
    }
    if (current) parts.push(current);
    return parts;
}

async function resolveInput(input) {
    if (!input) return '';
    if (typeof input === 'string') {
        if (await fsp.stat(input).then((s) => s.isFile()).catch(() => false)) {
            return await fsp.readFile(input, 'utf-8');
        }
        return input;
    }
    if (input.content !== undefined) return input.content;
    if (input.src) return await fsp.readFile(input.src, 'utf-8');
    return '';
}

async function copyInFile(filePath, content) {
    await fs.ensureDir(path.dirname(filePath));
    if (typeof content === 'string' || Buffer.isBuffer(content)) {
        await fsp.writeFile(filePath, content);
    } else if (content.content !== undefined) {
        await fsp.writeFile(filePath, content.content);
    } else if (content.src) {
        await fs.copy(content.src, filePath);
    } else if (content.fileId) {
        await fs.copy(content.fileId, filePath);
    }
    if (process.platform !== 'win32') {
        await fsp.chmod(filePath, 0o755).catch(() => {});
    }
}

function readLinuxMemoryKb(pid) {
    try {
        const statusText = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
        const hwm = /^VmHWM:\s+(\d+)\s+kB$/m.exec(statusText);
        if (hwm) return parseInt(hwm[1], 10);
        const rss = /^VmRSS:\s+(\d+)\s+kB$/m.exec(statusText);
        if (rss) return parseInt(rss[1], 10);
    } catch (e) {
        // process may have already exited
    }
    return 0;
}

function readWindowsMemoryKb(pid) {
    try {
        const script = `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -First 1).PeakWorkingSet64`;
        const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
            windowsHide: true,
            timeout: 1000,
            encoding: 'utf-8',
        }).trim();
        const bytes = parseInt(out, 10);
        return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1024) : 0;
    } catch (e) {
        return 0;
    }
}

function readProcessMemoryKb(pid) {
    if (!pid) return 0;
    if (process.platform === 'win32') return readWindowsMemoryKb(pid);
    return readLinuxMemoryKb(pid);
}

async function run(execute, params = {}) {
    const {
        time_limit_ms = SYSTEM_TIME_LIMIT_MS,
        memory_limit_mb = SYSTEM_MEMORY_LIMIT_MB,
        stack_limit_mb = SYSTEM_STACK_LIMIT_MB,
        stdin,
        stdout: stdoutPath,
        stderr: stderrPath,
        copyIn = {},
        copyOut = [],
        copyOutCached = [],
    } = params;

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hydrojudge-'));

    try {
        for (const [name, content] of Object.entries(copyIn)) {
            const filePath = path.join(tempDir, name);
            await copyInFile(filePath, content);
            log.info('Sandbox copyIn', {
                name,
                target: filePath,
                source: content && (content.src || content.fileId || ''),
                exists: await fs.pathExists(filePath),
            });
        }

        const commandDir = tempDir.replace(/\\/g, '/');
        const cmdParts = parseCmd(execute.replace(/\$\{dir\}/g, commandDir));
        const command = cmdParts[0];
        const args = cmdParts.slice(1);
        log.info('Sandbox run start', {
            execute,
            command,
            args,
            cwd: tempDir,
            copyIn: Object.keys(copyIn),
            copyOut,
            copyOutCached,
            time_limit_ms,
            memory_limit_mb,
            stack_limit_mb,
        });

        const stdinContent = await resolveInput(stdin);

        let stdoutData = '';
        let stderrData = '';
        let timeUsage = 0;
        let memoryUsage = 0;
        let exitCode = 0;
        let spawnError = '';
        let timedOut = false;
        let outputLimited = false;
        const outputLimit = 1024 * 1024 * 16;

        const startTime = Date.now();

        const spawnOptions = {
            cwd: tempDir,
            env: {
                ...process.env,
                PATH: process.env.PATH,
                HOME: tempDir,
            },
            windowsHide: true,
        };

        const isLinux = process.platform === 'linux';
        const stackLimitEnabled = isLinux;
        log.info('Sandbox spawn config', { isLinux, stackLimitEnabled });

        await new Promise((resolve) => {
            const child = spawn(command, args, spawnOptions);
            
            if (stackLimitEnabled && child.pid) {
                try {
                    const { execFileSync } = require('child_process');
                    execFileSync('prlimit', ['--pid', String(child.pid), '--stack=unlimited:unlimited'], { timeout: 1000 });
                    log.info('Sandbox stack limit set to unlimited', { pid: child.pid });
                } catch (e) {
                    log.warn('Sandbox stack limit failed', { error: e.message });
                }
            }
            
            const sampleMemory = () => {
                memoryUsage = Math.max(memoryUsage, readProcessMemoryKb(child.pid));
            };
            const memoryTimer = setInterval(sampleMemory, 50);
            sampleMemory();

            if (stdinContent) {
                child.stdin.write(stdinContent);
            }
            child.stdin.end();

            child.stdout.on('data', (data) => {
                stdoutData += data.toString('utf-8');
                if (stdoutData.length > outputLimit && !outputLimited) {
                    outputLimited = true;
                    child.kill('SIGTERM');
                }
            });

            child.stderr.on('data', (data) => {
                stderrData += data.toString('utf-8');
                if (stderrData.length > outputLimit && !outputLimited) {
                    outputLimited = true;
                    child.kill('SIGTERM');
                }
            });

            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
                setTimeout(() => {
                    child.kill('SIGKILL');
                }, 1000);
            }, time_limit_ms * 3);

            child.on('close', (code) => {
                clearTimeout(timeout);
                clearInterval(memoryTimer);
                sampleMemory();
                exitCode = code;
                timeUsage = Date.now() - startTime;
                resolve();
            });

            child.on('error', (err) => {
                clearTimeout(timeout);
                clearInterval(memoryTimer);
                spawnError = err.message;
                stderrData += `Spawn error: ${err.message}`;
                exitCode = -1;
                resolve();
            });
        });

        const resultFiles = {
            stdout: stdoutData,
            stderr: stderrData,
        };
        const fileIds = {};

        for (const fileName of copyOut) {
            const filePath = path.join(tempDir, fileName);
            if (await fs.pathExists(filePath)) {
                resultFiles[fileName] = await fsp.readFile(filePath, 'utf-8');
            }
        }

        for (const fileName of copyOutCached) {
            const filePath = path.join(tempDir, fileName);
            if (await fs.pathExists(filePath)) {
                const cachePath = path.join(CACHE_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}-${path.basename(fileName)}`);
                await fs.copy(filePath, cachePath);
                if (process.platform !== 'win32') {
                    await fsp.chmod(cachePath, 0o755).catch(() => {});
                }
                fileIds[fileName] = cachePath;
            }
        }

        if (stdoutPath) {
            await fsp.writeFile(stdoutPath, stdoutData);
        }
        if (stderrPath) {
            await fsp.writeFile(stderrPath, stderrData);
        }

        let statusCode = status.STATUS_ACCEPTED;
        if (timedOut) {
            statusCode = status.STATUS_TIME_LIMIT_EXCEEDED;
        } else if (exitCode !== 0) {
            statusCode = status.STATUS_RUNTIME_ERROR;
        } else if (outputLimited) {
            statusCode = status.STATUS_RUNTIME_ERROR;
        }

        const ret = {
            status: statusCode,
            time_usage_ms: timeUsage,
            memory_usage_kb: memoryUsage,
            files: resultFiles,
            code: exitCode,
            error: spawnError,
            stdout: stdoutPath ? undefined : stdoutData,
            stderr: stderrPath ? undefined : stderrData,
            fileIds,
        };
        log.info('Sandbox run finished', {
            command,
            args,
            cwd: tempDir,
            status: statusCode,
            code: exitCode,
            error: spawnError,
            time_usage_ms: timeUsage,
            stdout: stdoutData ? stdoutData.slice(0, 1000) : '',
            stderr: stderrData ? stderrData.slice(0, 1000) : '',
            files: Object.keys(resultFiles),
            fileIds,
        });

        return ret;
    } finally {
        try {
            await fsp.remove(tempDir);
        } catch (e) {
            // ignore
        }
    }
}

async function runMultiple(execute) {
    throw new SystemError('runMultiple not supported on Windows');
}

async function del(fileId) {
    if (fileId) {
        await fs.remove(fileId).catch(() => {});
    }
    return {};
}

module.exports = { del, run, runMultiple };
