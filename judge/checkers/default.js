const fs = require('fs-extra');
const { STATUS_ACCEPTED, STATUS_WRONG_ANSWER } = require('../status');

function normalizeOutput(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .filter((line) => line.length > 0)
        .join('\n');
}

function firstDifference(expected, actual) {
    const expectedTokens = expected.split(/\s+/).filter(Boolean);
    const actualTokens = actual.split(/\s+/).filter(Boolean);
    const len = Math.max(expectedTokens.length, actualTokens.length);
    for (let i = 0; i < len; i++) {
        if (expectedTokens[i] !== actualTokens[i]) {
            return `expected ${expectedTokens[i] || '<EOF>'}, got ${actualTokens[i] || '<EOF>'}`;
        }
    }
    return 'output differs';
}

async function check(config) {
    const [expectedRaw, actualRaw] = await Promise.all([
        fs.readFile(config.output, 'utf-8'),
        fs.readFile(config.user_stdout, 'utf-8'),
    ]);
    const expected = normalizeOutput(expectedRaw);
    const actual = normalizeOutput(actualRaw);
    const accepted = expected === actual;
    return {
        score: accepted ? config.score : 0,
        status: accepted ? STATUS_ACCEPTED : STATUS_WRONG_ANSWER,
        message: accepted || !config.detail ? '' : firstDifference(expected, actual),
    };
}

async function compile() {
    return {};
}

module.exports = { check, compile };
