const http = require('http');
const url = require('url');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const readCases = require('./cases');
const judge = require('./judge');
const log = require('./log');
const { STATUS_COMPILE_ERROR, STATUS_SYSTEM_ERROR } = require('./status');

const PORT = Number(process.env.JUDGE_PORT || 5000);
const JUDGE_TOKEN = process.env.JUDGE_TOKEN || '';
const JUDGE_DATA_DIR = path.resolve(process.env.JUDGE_DATA_DIR || path.join(os.tmpdir(), 'hydro', 'judge-data'));
const MAX_JSON_BODY_BYTES = Number(process.env.JUDGE_MAX_BODY_MB || 256) * 1024 * 1024;
const TASK_TIMEOUT_MS = Number(process.env.JUDGE_TASK_TIMEOUT_MS || 300) * 1000;
const tasks = {};
let taskSeq = 0;

fs.ensureDirSync(JUDGE_DATA_DIR);

function jsonResponse(response, statusCode, payload) {
    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
}

function checkAuth(request, response) {
    if (!JUDGE_TOKEN) return true;
    const header = request.headers.authorization || '';
    if (header === `Bearer ${JUDGE_TOKEN}`) return true;
    jsonResponse(response, 401, { success: false, error: 'Unauthorized' });
    return false;
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let size = 0;
        let body = '';
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_JSON_BODY_BYTES) {
                reject(new Error('Request body too large'));
                request.destroy();
                return;
            }
            body += chunk;
        });
        request.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error(`Invalid JSON: ${e.message}`));
            }
        });
        request.on('error', reject);
    });
}

function assertDataId(dataId) {
    if (!dataId || !/^[a-zA-Z0-9_.-]+$/.test(dataId)) throw new Error('Invalid data_id');
    return dataId;
}

function resolveDataDir(dataId) {
    const safeId = assertDataId(dataId);
    const dir = path.resolve(JUDGE_DATA_DIR, safeId);
    const root = `${JUDGE_DATA_DIR}${path.sep}`;
    if (dir !== JUDGE_DATA_DIR && dir.startsWith(root)) return dir;
    throw new Error('Invalid data directory');
}

function safeRelativePath(filePath) {
    if (!filePath || typeof filePath !== 'string') throw new Error('Invalid file path');
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
        throw new Error(`Absolute paths are not allowed: ${filePath}`);
    }
    const clean = path.posix.normalize(normalized);
    if (clean === '.' || clean.startsWith('../') || clean.includes('/../')) {
        throw new Error(`Unsafe file path: ${filePath}`);
    }
    return clean;
}

class JudgeContext {
    constructor(request, taskId) {
        this.request = request;
        this.taskId = taskId;
        this.rid = request.rid;
        this.pid = request.pid;
        this.lang = request.lang;
        this.code = request.code;
        this.data = request.data;
        this.data_id = request.data_id;
        this.tmpdir = path.resolve(os.tmpdir(), 'hydro', 'judge', request.rid);
        fs.ensureDirSync(this.tmpdir);
        this.nextId = 1;
        this.nextWaiting = [];
        this.total_status = 0;
        this.total_score = 0;
        this.total_time_usage_ms = 0;
        this.total_memory_usage_kb = 0;
        this.stat = { receive: new Date() };
        this.clean = [];
        this.next = this.next.bind(this);
        this.end = this.end.bind(this);
        this.fail = this.fail.bind(this);
    }

    next(data, caseId) {
        data.operation = 'next';
        data.rid = this.request.rid;
        data.time = data.time_ms || data.time;
        data.memory = data.memory_kb || data.memory;
        data.message = data.judge_text || data.message;
        data.compilerText = data.compiler_text || data.compilerText;
        if (data.case) {
            data.case = {
                status: data.case.status,
                time: data.case.time_ms || data.case.time,
                memory: data.case.memory_kb || data.case.memory,
                message: data.case.judge_text || data.case.message || data.judge_text || data.message || data.judgeText || '',
                score: data.case.score || 0,
                id: data.case.id || caseId,
                input: data.case.input || '',
                output: data.case.output || '',
                max_score: data.case.max_score || 0,
            };
            if (tasks[this.request.rid] && tasks[this.request.rid].task_id === this.taskId) {
                tasks[this.request.rid].case_results.push(data.case);
            }
        }
        if (tasks[this.request.rid] && tasks[this.request.rid].task_id === this.taskId && tasks[this.request.rid].status === 'running') {
            tasks[this.request.rid].progress = data;
        }
    }

    end(data) {
        if (!tasks[this.request.rid] || tasks[this.request.rid].task_id !== this.taskId || tasks[this.request.rid].status !== 'running') return;
        data.operation = 'end';
        data.rid = this.request.rid;
        data.time = data.time_ms || data.time;
        data.memory = data.memory_kb || data.memory;
        data.case_results = data.case_results || tasks[this.request.rid].case_results || [];
        tasks[this.request.rid].result = data;
        tasks[this.request.rid].status = 'completed';
        tasks[this.request.rid].completed_at = new Date().toISOString();
        log.log(`Judge completed: ${this.request.rid}`, data);
    }

    fail(error) {
        this.end({
            status: STATUS_SYSTEM_ERROR,
            score: 0,
            time_ms: 0,
            memory_kb: 0,
            judge_text: error && error.message ? error.message : String(error || 'Judge failed'),
        });
    }
}

async function handleDataUpload(request, response) {
    try {
        const body = await readJsonBody(request);
        const dataId = assertDataId(body.data_id);
        const files = Array.isArray(body.files) ? body.files : [];
        if (!files.length) throw new Error('No files provided');

        const targetDir = resolveDataDir(dataId);
        await fs.remove(targetDir);
        await fs.ensureDir(targetDir);

        let totalBytes = 0;
        for (const file of files) {
            const relPath = safeRelativePath(file.path);
            const content = Buffer.from(file.content_base64 || '', 'base64');
            totalBytes += content.length;
            const targetPath = path.resolve(targetDir, relPath);
            if (!targetPath.startsWith(`${targetDir}${path.sep}`)) {
                throw new Error(`Unsafe file path: ${file.path}`);
            }
            await fs.ensureDir(path.dirname(targetPath));
            await fs.writeFile(targetPath, content);
        }

        jsonResponse(response, 200, {
            success: true,
            data_id: dataId,
            file_count: files.length,
            size: totalBytes,
        });
    } catch (e) {
        jsonResponse(response, 400, { success: false, error: e.message });
    }
}

async function handleDataStatus(request, response) {
    try {
        const query = url.parse(request.url, true).query;
        const dataId = assertDataId(query.data_id);
        const dir = resolveDataDir(dataId);
        const exists = await fs.pathExists(dir);
        jsonResponse(response, 200, { success: true, data_id: dataId, exists });
    } catch (e) {
        jsonResponse(response, 400, { success: false, error: e.message });
    }
}

async function listFiles(rootDir) {
    const result = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
                await walk(fullPath);
            } else {
                result.push({
                    path: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
                    size: stat.size,
                });
            }
        }
    }
    if (await fs.pathExists(rootDir)) await walk(rootDir);
    result.sort((a, b) => a.path.localeCompare(b.path));
    return result;
}

async function handleDataFiles(request, response) {
    try {
        const query = url.parse(request.url, true).query;
        const dataId = assertDataId(query.data_id);
        const dir = resolveDataDir(dataId);
        const exists = await fs.pathExists(dir);
        const files = exists ? await listFiles(dir) : [];
        const configPath = path.join(dir, 'config.yaml');
        const configYaml = exists && await fs.pathExists(configPath)
            ? (await fs.readFile(configPath)).toString().slice(0, 16384)
            : null;
        jsonResponse(response, 200, {
            success: true,
            data_id: dataId,
            data_dir: dir,
            exists,
            file_count: files.length,
            files,
            config_yaml: configYaml,
        });
    } catch (e) {
        jsonResponse(response, 400, { success: false, error: e.message });
    }
}

async function handleJudgeSubmit(request, response) {
    let ctx = null;
    try {
        const data = await readJsonBody(request);
        const {
            rid, pid, code, lang, data: requestedTestdataPath, data_id: dataId, time_limit, memory_limit,
        } = data;
        const testdataPath = dataId ? resolveDataDir(dataId) : requestedTestdataPath;
        if (!rid || !code || !lang) throw new Error('Missing rid, code or lang');
        if (!testdataPath) throw new Error('Missing testdata path or data_id');
        if (!await fs.pathExists(testdataPath)) throw new Error(`Testdata not found: ${dataId || testdataPath}`);

        const taskId = ++taskSeq;
        log.log(`Judge received: ${rid} pid=${pid} data=${dataId || testdataPath}`);
        tasks[rid] = {
            task_id: taskId,
            status: 'running',
            progress: null,
            result: null,
            case_results: [],
            received_at: new Date().toISOString(),
        };

        ctx = new JudgeContext({
            rid, pid, lang, code, data: testdataPath, data_id: dataId,
        }, taskId);

        ctx.config = await readCases(
            testdataPath,
            { detail: true },
            { next: ctx.next },
        );

        ctx.config.concurrency = 2;
        ctx.config.subtasks.forEach((subtask) => {
            subtask.time_limit_ms = time_limit || subtask.time_limit_ms || 1000;
            subtask.memory_limit_mb = memory_limit || subtask.memory_limit_mb || 64;
            subtask.cases.forEach((c) => {
                c.time_limit_ms = subtask.time_limit_ms;
                c.memory_limit_mb = subtask.memory_limit_mb;
            });
        });

        const timeout = setTimeout(() => {
            log.error(`Judge timeout: ${rid} after ${TASK_TIMEOUT_MS}ms`);
            ctx.fail(new Error(`Judge timeout after ${Math.floor(TASK_TIMEOUT_MS / 1000)} seconds`));
        }, TASK_TIMEOUT_MS);

        setTimeout(async () => {
            try {
                await judge[ctx.config.type || 'default'].judge(ctx);
            } catch (e) {
                log.error('Judge failed:', e);
                const isCompileError = e && e.type === 'CompileError';
                ctx.end({
                    status: isCompileError ? STATUS_COMPILE_ERROR : STATUS_SYSTEM_ERROR,
                    score: 0,
                    time_ms: 0,
                    memory_kb: 0,
                    compiler_text: isCompileError ? [e.stdout, e.stderr].filter(Boolean).join('\n') : '',
                    judge_text: isCompileError ? '' : e.message,
                });
            } finally {
                clearTimeout(timeout);
                await fs.remove(ctx.tmpdir).catch(() => {});
            }
        }, 0);

        jsonResponse(response, 200, { success: true, rid, task_id: taskId, data_id: dataId || null });
    } catch (e) {
        if (ctx) {
            log.error('Judge setup failed:', e);
            ctx.fail(e);
        }
        jsonResponse(response, 400, { success: false, error: e.message });
    }
}

function handleJudgeStatus(request, response) {
    const query = url.parse(request.url, true).query;
    const { rid } = query;
    if (!rid || !tasks[rid]) {
        jsonResponse(response, 404, { success: false, error: 'Task not found' });
        return;
    }
    jsonResponse(response, 200, tasks[rid]);
}

function handleTest(request, response) {
    jsonResponse(response, 200, { status: 'ok', message: 'Hydro_Judge HTTP worker is running' });
}

function handleStatus(request, response) {
    const now = new Date();
    const runningCount = Object.values(tasks).filter((t) => t.status === 'running').length;
    const completedCount = Object.values(tasks).filter((t) => t.status === 'completed').length;
    jsonResponse(response, 200, {
        status: 'online',
        uptime: Math.floor((now - server.startTime) / 1000),
        running_tasks: runningCount,
        completed_tasks: completedCount,
        total_tasks: Object.keys(tasks).length,
        version: '1.4.5',
        platform: process.platform,
        node_version: process.version,
        memory_usage: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
        data_dir: JUDGE_DATA_DIR,
        auth_enabled: Boolean(JUDGE_TOKEN),
    });
}

const server = http.createServer((request, response) => {
    const parsedUrl = url.parse(request.url);
    const pathname = parsedUrl.pathname;

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
        response.writeHead(200);
        response.end();
        return;
    }

    if (!checkAuth(request, response)) return;

    if (pathname === '/judge/submit' && request.method === 'POST') {
        handleJudgeSubmit(request, response);
    } else if (pathname === '/judge/status' && request.method === 'GET') {
        handleJudgeStatus(request, response);
    } else if (pathname === '/data/upload' && request.method === 'POST') {
        handleDataUpload(request, response);
    } else if (pathname === '/data/status' && request.method === 'GET') {
        handleDataStatus(request, response);
    } else if (pathname === '/data/files' && request.method === 'GET') {
        handleDataFiles(request, response);
    } else if (pathname === '/test' && request.method === 'GET') {
        handleTest(request, response);
    } else if (pathname === '/status' && request.method === 'GET') {
        handleStatus(request, response);
    } else {
        jsonResponse(response, 404, { success: false, error: 'Not found' });
    }
});

server.startTime = new Date();

server.listen(PORT, () => {
    console.log('Hydro_Judge HTTP worker started');
    console.log(`Port: ${PORT}`);
    console.log(`Data dir: ${JUDGE_DATA_DIR}`);
    console.log(`Auth: ${JUDGE_TOKEN ? 'enabled' : 'disabled'}`);
});

process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});
