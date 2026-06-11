const fs = require('fs-extra');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.ensureDirSync(LOG_DIR);

function getLogFileName() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.log`;
}

function writeLog(level, message) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    
    const logFile = path.join(LOG_DIR, getLogFileName());
    fs.appendFileSync(logFile, logLine, 'utf-8');
}

function wrap(func, level) {
    return (...args) => {
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
        
        func(`[${level.toUpperCase()}] ${message}`);
        writeLog(level, message);
    };
}

class Logger {
    constructor() {
        this.log = wrap(console.log, 'log');
        this.error = wrap(console.error, 'error');
        this.info = wrap(console.info, 'info');
        this.warn = wrap(console.warn, 'warn');
        this.debug = wrap(console.debug, 'debug');
        this.submission = (id, payload = {}) => {
            const message = `${id} ${JSON.stringify(payload)}`;
            console.log(`[LOG] ${message}`);
            writeLog('log', message);
        };
    }

    logger(logger) {
        this.log = wrap(logger.log, 'log');
        this.error = wrap(logger.error, 'error');
        this.info = wrap(logger.info, 'info');
        this.warn = wrap(logger.warn, 'warn');
        this.debug = wrap(logger.debug, 'debug');
        this.submission = (id, payload = {}) => {
            const message = `${id} ${JSON.stringify(payload)}`;
            logger.log(`[LOG] ${message}`);
            writeLog('log', message);
        };
    }
}

module.exports = new Logger();