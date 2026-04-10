#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

function loadEnvConfig() {
  const envPath = path.join(ROOT_DIR, '.env');
  const config = {
    DEPLOY_HOST: '',
    DEPLOY_USER: '',
    DEPLOY_PORT: '22',
    DEPLOY_SSH_KEY: '',
    DEPLOY_SSH_PASSWORD: '',
    DEPLOY_SCRIPT_PATH: '',
  };

  if (!fs.existsSync(envPath)) {
    return config;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) {
      return;
    }

    const key = match[1].trim();
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (Object.prototype.hasOwnProperty.call(config, key)) {
      config[key] = value;
    }
  });

  return config;
}

function getCurrentVersion() {
  const packagePath = path.join(ROOT_DIR, 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

function resolveSshKeyPath(sshKey) {
  if (!sshKey) {
    return '';
  }

  if (sshKey.startsWith('/')) {
    return sshKey;
  }

  if (sshKey.startsWith('~/')) {
    return path.join(process.env.HOME || '', sshKey.slice(2));
  }

  return path.join(process.env.HOME || '', sshKey);
}

function checkSshpassInstalled() {
  try {
    execFileSync('which', ['sshpass'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function getRollbackScriptPath(deployScriptPath) {
  const normalizedPath = deployScriptPath.replace(/\\/g, '/');
  const deployDir = path.posix.dirname(normalizedPath);
  return path.posix.join(deployDir, 'rollback.sh');
}

function getRequestedVersion() {
  const cliVersion = process.argv.slice(2).find((arg) => arg && !arg.startsWith('-'));
  return cliVersion || getCurrentVersion();
}

function formatExecError(error) {
  const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8') : error.stdout || '';
  const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : error.stderr || '';
  return stderr.trim() || stdout.trim() || error.message || '未知错误';
}

function executeCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const error = new Error(stderr.trim() || stdout.trim() || `${command} 执行失败`);
    error.status = result.status;
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  }

  return `${stdout}\n${stderr}`.trim();
}

function assertRollbackSucceeded(output) {
  const failurePatterns = [
    /取消回滚/,
    /取消发布/,
    /已取消/,
    /操作已取消/,
    /\[INFO\]\s*取消/,
  ];

  if (failurePatterns.some((pattern) => pattern.test(output))) {
    throw new Error('远端 rollback.sh 已取消执行');
  }
}

function runRemoteRollback(config, version) {
  if (!config.DEPLOY_HOST || !config.DEPLOY_USER) {
    throw new Error('缺少 DEPLOY_HOST 或 DEPLOY_USER 配置');
  }

  if (!config.DEPLOY_SCRIPT_PATH) {
    throw new Error('缺少 DEPLOY_SCRIPT_PATH 配置');
  }

  const rollbackScriptPath = getRollbackScriptPath(config.DEPLOY_SCRIPT_PATH);
  const rollbackDir = path.posix.dirname(rollbackScriptPath);
  const remoteCommand = `cd ${shellEscape(rollbackDir)} && ./rollback.sh --yes ${shellEscape(version)}`;

  const sshArgs = [];
  const sshKeyPath = resolveSshKeyPath(config.DEPLOY_SSH_KEY);
  const useSshKey = sshKeyPath && fs.existsSync(sshKeyPath);
  const usePassword = !useSshKey && config.DEPLOY_SSH_PASSWORD;

  if (config.DEPLOY_PORT && config.DEPLOY_PORT !== '22') {
    sshArgs.push('-p', config.DEPLOY_PORT);
  }
  if (useSshKey) {
    sshArgs.push('-i', sshKeyPath);
  }
  sshArgs.push('-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null');
  sshArgs.push(`${config.DEPLOY_USER}@${config.DEPLOY_HOST}`, remoteCommand);

  console.log(`🚀 开始发布版本: ${version}`);
  console.log(`📄 远程脚本: ${rollbackScriptPath}`);

  try {
    let output = '';

    if (usePassword) {
      if (!checkSshpassInstalled()) {
        throw new Error('检测到 DEPLOY_SSH_PASSWORD，但本机未安装 sshpass');
      }

      output = executeCommand('sshpass', ['-p', config.DEPLOY_SSH_PASSWORD, 'ssh', ...sshArgs]);
    } else {
      output = executeCommand('ssh', sshArgs);
    }

    assertRollbackSucceeded(output);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      throw new Error(formatExecError(error));
    }
    throw error;
  }
}

function main() {
  const version = getRequestedVersion();
  const config = loadEnvConfig();

  runRemoteRollback(config, version);

  console.log('\n✅ 发布完成');
  console.log(`💡 当前版本: ${version}`);
}

try {
  main();
} catch (error) {
  console.error(`\n❌ 发布失败: ${error.message}`);
  process.exit(1);
}
