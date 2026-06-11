const path = require('path');
const fs = require('fs-extra');
const { run } = require('./sandbox');
const compile = require('./compile');
const readCases = require('./cases');
const judge = require('./judge');

const tmpdir = path.resolve(require('os').tmpdir(), 'hydro_test_' + Date.now());
fs.ensureDirSync(tmpdir);

async function testSandbox() {
    console.log('\n=== 测试1: 沙箱执行器 ===');
    try {
        const res = await run('node -e "console.log(\'hello world\')"', {
            stdin: '',
            time_limit_ms: 1000,
            memory_limit_mb: 64,
        });
        console.log('输出:', res.stdout.toString());
        console.log('状态:', res.status === 1 ? 'ACCEPTED' : res.status);
        console.log('时间:', res.time_usage_ms, 'ms');
        console.log('内存:', res.memory_usage_kb, 'KB');
        return res.status === 1;
    } catch (e) {
        console.error('错误:', e.message);
        return false;
    }
}

async function testCompile() {
    console.log('\n=== 测试2: 编译器 ===');
    const code = `#include <iostream>
using namespace std;
int main() {
    cout << "Hello World" << endl;
    return 0;
}`;
    try {
        const [execute] = await Promise.all([
            compile('cc', code, 'test', {}, () => {}),
        ]);
        console.log('编译成功');
        console.log('可执行文件:', execute.execute);
        return true;
    } catch (e) {
        console.error('编译失败:', e.message);
        return false;
    }
}

async function testPythonCompile() {
    console.log('\n=== 测试3: Python 编译 ===');
    const code = `print("Hello World")`;
    try {
        const [execute] = await Promise.all([
            compile('py', code, 'test', {}, () => {}),
        ]);
        console.log('编译成功');
        console.log('执行命令:', execute.execute);
        return true;
    } catch (e) {
        console.error('编译失败:', e.message);
        return false;
    }
}

async function main() {
    console.log('Hydro_Judge 测试工具');
    
    const results = [];
    
    results.push(await testSandbox());
    results.push(await testCompile());
    results.push(await testPythonCompile());
    
    fs.removeSync(tmpdir);
    
    console.log('\n=== 测试结果 ===');
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    if (passed === total) {
        console.log(`✅ 全部通过 (${passed}/${total})`);
        console.log('\nHydro_Judge 工作正常！');
        process.exit(0);
    } else {
        console.log(`❌ 部分失败 (${passed}/${total})`);
        console.log('\n请检查环境配置：');
        console.log('  1. 确保已安装 gcc/g++ (用于 C/C++)');
        console.log('  2. 确保已安装 Python');
        console.log('  3. 确保 langs_win.yaml 配置正确');
        process.exit(1);
    }
}

main().catch(e => {
    console.error('测试异常:', e);
    fs.removeSync(tmpdir);
    process.exit(1);
});
