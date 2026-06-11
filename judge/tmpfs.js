const { platform } = require('os');
const child = require('child_process');
const fs = require('fs-extra');

if (platform() === 'win32') {
    function mount(path, size) {
        fs.ensureDirSync(path);
    }

    function umount(path) {
        try {
            fs.removeSync(path);
        } catch (e) {
            // ignore
        }
    }

    module.exports = { mount, umount };
} else {
    function mount(path, size = '32m') {
        fs.ensureDirSync(path);
        child.execSync(`mount tmpfs ${path} -t tmpfs -o size=${size}`);
    }

    function umount(path) {
        child.execSync(`umount ${path}`);
    }

    module.exports = { mount, umount };
}
