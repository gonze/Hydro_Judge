const fs = require('fs-extra');
const yaml = require('js-yaml');
const path = require('path');
const { FormatError } = require('../error');
const { parseTimeMS, parseMemoryMB, ensureFile } = require('../utils');
const readAutoCases = require('./auto');

const fsp = fs.promises;

function readConfigFile(folder, name, args) {
    if (args.config) return args.config;
    return fsp.readFile(path.resolve(folder, name)).then((buffer) => buffer.toString());
}

function normalizeCase(rawCase, checkFile, id) {
    if (!rawCase || typeof rawCase !== 'object') throw new FormatError('Invalid testcase config');
    if (!rawCase.input || !rawCase.output) throw new FormatError('Testcase input/output is required');
    const c = {
        input: checkFile(rawCase.input, 'Input file not found: '),
        output: checkFile(rawCase.output, 'Output file not found: '),
        id,
    };
    if (rawCase.score !== undefined) c.score = parseInt(rawCase.score);
    if (rawCase.time) c.time_limit_ms = parseTimeMS(rawCase.time);
    if (rawCase.memory) c.memory_limit_mb = parseMemoryMB(rawCase.memory);
    return c;
}

function normalizeExtraFiles(files, checkFile, message) {
    if (!files) return [];
    if (typeof files === 'string') return [checkFile(files, message)];
    if (Array.isArray(files)) return files.map((file) => checkFile(file, message));
    throw new FormatError(`Invalid extra files config: ${message}`);
}

module.exports = async function readYamlCases(folder, name, args) {
    const config = {
        checker_type: 'default',
        count: 0,
        subtasks: [],
        judge_extra_files: [],
        user_extra_files: [],
    };
    const next = args.next;
    const checkFile = ensureFile(folder);
    const configText = await readConfigFile(folder, name, args);
    const configFile = yaml.safeLoad(configText) || {};

    config.checker_type = configFile.checker_type || 'default';
    if (configFile.filename) config.filename = configFile.filename;
    if (configFile.checker) config.checker = checkFile(configFile.checker, 'Checker not found: ');
    config.judge_extra_files = normalizeExtraFiles(configFile.judge_extra_files, checkFile, 'Judge extra file not found: ');
    config.user_extra_files = normalizeExtraFiles(configFile.user_extra_files, checkFile, 'User extra file not found: ');

    if (Array.isArray(configFile.cases) && configFile.cases.length) {
        const subtask = {
            score: parseInt(configFile.score) || 100,
            time_limit_ms: parseTimeMS(configFile.time),
            memory_limit_mb: parseMemoryMB(configFile.memory),
            cases: [],
            type: 'sum',
        };
        for (const rawCase of configFile.cases) {
            config.count++;
            subtask.cases.push(normalizeCase(rawCase, checkFile, config.count));
        }
        config.subtasks.push(subtask);
    } else if (Array.isArray(configFile.subtasks) && configFile.subtasks.length) {
        for (const rawSubtask of configFile.subtasks) {
            const rawCases = Array.isArray(rawSubtask.cases)
                ? rawSubtask.cases
                : (Array.isArray(rawSubtask) ? rawSubtask : []);
            const cases = [];
            for (const rawCase of rawCases) {
                config.count++;
                cases.push(normalizeCase(rawCase, checkFile, config.count));
            }
            if (!cases.length) continue;
            config.subtasks.push({
                score: parseInt(rawSubtask.score) || 0,
                type: rawSubtask.type || 'sum',
                cases,
                time_limit_ms: parseTimeMS(rawSubtask.time || configFile.time),
                memory_limit_mb: parseMemoryMB(rawSubtask.memory || configFile.memory),
            });
        }
    } else if (configFile.type !== 'remotejudge') {
        const detected = await readAutoCases(folder, '', { next });
        config.subtasks = detected.subtasks;
        config.count = detected.count;
    }

    if (config.count && config.subtasks.length) {
        const unsetScoreSubtasks = config.subtasks.filter((subtask) => !subtask.score);
        if (unsetScoreSubtasks.length === config.subtasks.length) {
            const base = Math.floor(100 / config.subtasks.length);
            let extra = 100 % config.subtasks.length;
            for (const subtask of config.subtasks) {
                subtask.score = base + (extra > 0 ? 1 : 0);
                extra--;
            }
        }
    }

    return Object.assign(configFile, config);
};
