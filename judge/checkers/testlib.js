const fs = require('fs-extra');
const path = require('path');
const { run } = require('../sandbox');
const { FILES_DIR } = require('../config');
const { STATUS_ACCEPTED, STATUS_WRONG_ANSWER } = require('../status');
const _compile = require('../compile');

const fsp = fs.promises;

async function check(config) {
    const {
        status, stdout, stderr, error,
    } = await run('${dir}/checker ${dir}/in ${dir}/user_out ${dir}/answer', {
        copyIn: Object.assign({}, config.copyIn || {}, {
            in: { src: config.input },
            user_out: { src: config.user_stdout },
            answer: { src: config.output },
        }),
    });
    const accepted = status === STATUS_ACCEPTED;
    return {
        status: accepted ? STATUS_ACCEPTED : STATUS_WRONG_ANSWER,
        score: accepted ? config.score : 0,
        message: [stderr, stdout, error].filter(Boolean).join('\n').trim(),
    };
}

async function compileChecker(checker, copyIn) {
    const compileCopyIn = Object.assign({}, copyIn || {}, {
        'testlib.h': { src: path.resolve(FILES_DIR, 'testlib.h') },
    });
    const file = await fsp.readFile(checker, 'utf8');
    return await _compile(checker.split('.')[1], file, 'checker', compileCopyIn);
}

async function compileInteractor(interactor, copyIn) {
    const compileCopyIn = Object.assign({}, copyIn || {}, {
        'testlib.h': { src: path.resolve(FILES_DIR, 'testlib.h') },
    });
    const file = await fsp.readFile(interactor, 'utf8');
    return await _compile(interactor.split('.')[1], file, 'interactor', compileCopyIn);
}

module.exports = {
    check,
    compile: compileChecker,
    compileChecker,
    compileInteractor,
};
