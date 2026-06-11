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

async function compile(lang, code, target, copyIn, next) {
    if (!_langs[lang]) throw new SystemError(`Unsupported language: ${lang}`);
    const info = _langs[lang];
    const f = {};
    if (info.type === 'compiler') {
        copyIn[info.code_file] = { content: code };
        const cachedTargets = IS_WINDOWS ? [target, `${target}.exe`] : [target];
        log.info('Compile start', {
            lang,
            target,
            command: info.compile.replace(/\$\{name\}/g, target),
            code_file: info.code_file,
            cachedTargets,
        });
        const {
            status, stdout, stderr, fileIds = {},
        } = await run(
            info.compile.replace(/\$\{name\}/g, target),
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
