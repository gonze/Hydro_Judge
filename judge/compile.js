const yaml = require('js-yaml');
const fs = require('fs-extra');
const { run, del } = require('./sandbox');
const { CompileError, SystemError } = require('./error');
const log = require('./log');
const { STATUS_ACCEPTED } = require('./status');
const { compilerText } = require('./utils');
const { LANGS_FILE, LANGS, IS_WINDOWS } = require('./config');

let _langs = {};
try {
    if (LANGS) _langs = LANGS;
    else _langs = yaml.safeLoad(fs.readFileSync(LANGS_FILE).toString());
} catch (e) {
    log.error('Invalid language file %s', LANGS_FILE);
    log.error(e);
    if (!global.Hydro) process.exit(1);
}

function normalizeLang(lang) {
    const value = String(lang || '').toLowerCase();
    return {
        cpp: 'cc',
        'c++': 'cc',
        cxx: 'cc',
        python: 'py3',
        python3: 'py3',
    }[value] || value;
}

function sanitizeCompileFlags(flags) {
    const text = String(flags || '').trim();
    if (!text) return '';
    if (/[;&|`$<>\\\r\n]/.test(text)) throw new SystemError('Invalid compile flags');
    return text;
}

function compileCommand(lang, info, target, options = {}) {
    const baseCommand = info.compile.replace(/\$\{name\}/g, target);
    const flags = sanitizeCompileFlags(options.compile_flags);
    if (IS_WINDOWS || !flags || !['cc', 'cc98', 'cc11', 'cc17'].includes(lang)) return baseCommand;
    return `/usr/bin/g++ ${flags} -o ${target} ${info.code_file} -lm`;
}

async function compile(lang, code, target, copyIn, next, options = {}) {
    lang = normalizeLang(lang);
    if (!_langs[lang]) throw new SystemError(`Unsupported language: ${lang}`);
    const info = _langs[lang];
    const f = {};
    if (info.type === 'compiler') {
        copyIn[info.code_file] = { content: code };
        const cachedTargets = IS_WINDOWS ? [target, `${target}.exe`] : [target];
        const command = compileCommand(lang, info, target, options);
        log.info('Compile start', {
            lang,
            target,
            command,
            code_file: info.code_file,
            cachedTargets,
        });
        const {
            status, stdout, stderr, fileIds = {},
        } = await run(
            command,
            { copyIn, copyOutCached: cachedTargets },
        );
        log.info('Compile finished', {
            lang,
            target,
            status,
            fileIds,
            stdout: stdout ? stdout.slice(0, 1000) : '',
            stderr: stderr ? stderr.slice(0, 1000) : '',
        });
        if (status !== STATUS_ACCEPTED) throw new CompileError({ status, stdout, stderr });
        const outputName = cachedTargets.find((name) => fileIds[name]);
        if (!outputName) throw new CompileError({ stderr: 'Executable file was not generated.' });
        if (next) next({ compiler_text: compilerText(stdout, stderr) });
        f[outputName] = { fileId: fileIds[outputName] };
        return { execute: info.execute, copyIn: f, clean: () => del(fileIds[outputName]) };
    }
    if (info.type === 'interpreter') {
        f[target] = { content: code };
        return { execute: info.execute, copyIn: f, clean: () => Promise.resolve() };
    }
    throw new SystemError(`Unsupported language type: ${info.type}`);
}

module.exports = compile;
