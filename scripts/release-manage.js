#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULTS = {
  RELEASE_HOST: '',
  RELEASE_USER: '',
  RELEASE_PORT: '',
  RELEASE_SSH_KEY: '',
  RELEASE_SSH_PASSWORD: '',
  RELEASES_DIR: '',
  RELEASE_MANAGE_SCRIPT: '',
  RELEASE_REMOTE_TMP_DIR: '',
  RELEASE_VERIFY_BASE_URL: '',
};

function loadEnvConfig() {
  const envPath = path.join(ROOT_DIR, '.env');
  const config = { ...DEFAULTS };

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

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function resolveSshKeyPath(sshKey) {
  if (!sshKey) return '';
  if (sshKey.startsWith('/')) return sshKey;
  if (sshKey.startsWith('~/')) {
    return path.join(process.env.HOME || '', sshKey.slice(2));
  }
  return path.join(process.env.HOME || '', sshKey);
}

function spawnChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败，退出码: ${result.status}`);
  }
}

function execOutput(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    ...options,
  }).trim();
}

function buildSshArgs(config, remoteCommand) {
  const sshArgs = [];
  const sshKeyPath = resolveSshKeyPath(config.RELEASE_SSH_KEY);
  const useSshKey = sshKeyPath && fs.existsSync(sshKeyPath);
  const usePassword = !useSshKey && config.RELEASE_SSH_PASSWORD;

  if (config.RELEASE_PORT && config.RELEASE_PORT !== '22') {
    sshArgs.push('-p', config.RELEASE_PORT);
  }
  if (useSshKey) {
    sshArgs.push('-i', sshKeyPath);
  }
  sshArgs.push(
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null'
  );
  sshArgs.push(`${config.RELEASE_USER}@${config.RELEASE_HOST}`);
  if (remoteCommand) {
    sshArgs.push(remoteCommand);
  }

  return { sshArgs, usePassword };
}

function runRemoteCommand(config, remoteCommand, options = {}) {
  const { sshArgs, usePassword } = buildSshArgs(config, remoteCommand);

  if (options.captureOutput) {
    if (usePassword) {
      return execOutput('sshpass', ['-p', config.RELEASE_SSH_PASSWORD, 'ssh', ...sshArgs]);
    }
    return execOutput('ssh', sshArgs);
  }

  if (usePassword) {
    spawnChecked('sshpass', ['-p', config.RELEASE_SSH_PASSWORD, 'ssh', ...sshArgs]);
    return '';
  }
  spawnChecked('ssh', sshArgs);
  return '';
}

function copyFileToRemote(config, localPath, remotePath) {
  const scpArgs = [];
  const sshKeyPath = resolveSshKeyPath(config.RELEASE_SSH_KEY);
  const useSshKey = sshKeyPath && fs.existsSync(sshKeyPath);
  const usePassword = !useSshKey && config.RELEASE_SSH_PASSWORD;

  if (config.RELEASE_PORT && config.RELEASE_PORT !== '22') {
    scpArgs.push('-P', config.RELEASE_PORT);
  }
  if (useSshKey) {
    scpArgs.push('-i', sshKeyPath);
  }
  scpArgs.push(
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    localPath,
    `${config.RELEASE_USER}@${config.RELEASE_HOST}:${remotePath}`
  );

  if (usePassword) {
    spawnChecked('sshpass', ['-p', config.RELEASE_SSH_PASSWORD, 'scp', ...scpArgs]);
    return;
  }
  spawnChecked('scp', scpArgs);
}

function getPackageVersion() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
  );
  return packageJson.version;
}

function ensureRequiredConfig(config) {
  const requiredKeys = [
    'RELEASE_HOST',
    'RELEASE_USER',
    'RELEASE_PORT',
    'RELEASES_DIR',
    'RELEASE_MANAGE_SCRIPT',
    'RELEASE_REMOTE_TMP_DIR',
    'RELEASE_VERIFY_BASE_URL',
  ];
  const missingKeys = requiredKeys.filter((key) => !String(config[key] || '').trim());

  if (missingKeys.length > 0) {
    throw new Error(
      `缺少发布配置: ${missingKeys.join(', ')}。请在 .env 中补齐 RELEASE_* 配置。`
    );
  }
}

function parseCliArgs(argv) {
  const options = {
    skipBuild: false,
    skipVerify: false,
    dryRun: false,
    overwrite: false,
    bumpIfExists: null,
    version: null,
  };

  const positional = [];
  for (const arg of argv) {
    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    if (arg === '--skip-verify') {
      options.skipVerify = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    if (arg.startsWith('--bump-if-exists=')) {
      options.bumpIfExists = arg.split('=')[1];
      continue;
    }
    if (arg.startsWith('--version=') || arg.startsWith('--v=')) {
      options.version = arg.split('=').slice(1).join('=');
      continue;
    }
    positional.push(arg);
  }

  let command = 'deploy';
  if (
    positional[0] &&
    ['deploy', 'activate', 'rollback', 'promote', 'remove', 'list', 'current'].includes(positional[0])
  ) {
    command = positional.shift();
  }
  if (!options.version && positional[0]) {
    options.version = positional[0];
  }

  return { command, options };
}

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) {
    throw new Error(`版本格式无效: ${version || '(empty)'}`);
  }
  return version;
}

function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`版本格式无效: ${version}`);
  }

  switch (type) {
    case 'major':
      parts[0] += 1;
      parts[1] = 0;
      parts[2] = 0;
      break;
    case 'minor':
      parts[1] += 1;
      parts[2] = 0;
      break;
    case 'patch':
    default:
      parts[2] += 1;
      break;
  }

  return parts.join('.');
}

function remoteVersionExists(config, version) {
  const command = `test -d ${shellEscape(
    path.posix.join(config.RELEASES_DIR, version)
  )} && echo exists || echo missing`;
  return runRemoteCommand(config, command, { captureOutput: true }) === 'exists';
}

function listRemoteVersions(config) {
  const command = [
    `find ${shellEscape(config.RELEASES_DIR)} -mindepth 1 -maxdepth 1 -type d -printf '%f\\n'`,
    `(grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$' || true)`,
    'sort -V',
  ].join(' | ');
  const output = runRemoteCommand(config, command, { captureOutput: true });
  return output ? output.split('\n').filter(Boolean) : [];
}

function getRemoteCurrentVersion(config) {
  const command = `readlink -f ${shellEscape(
    path.posix.join(config.RELEASES_DIR, 'current')
  )} | xargs -r basename`;
  return runRemoteCommand(config, command, { captureOutput: true });
}

function ensureReleaseVersion(config, initialVersion, bumpType, dryRun, overwrite) {
  let version = initialVersion;
  if (!remoteVersionExists(config, version)) {
    return version;
  }

  if (dryRun) {
    if (!bumpType) {
      console.log(`⚠️  远端已存在 ${version}，dry-run 模式下将走覆盖发布`);
      return version;
    }

    let dryRunVersion = bumpVersion(version, bumpType);
    while (remoteVersionExists(config, dryRunVersion)) {
      dryRunVersion = bumpVersion(dryRunVersion, 'patch');
    }
    console.log(`⚠️  远端已存在 ${version}，dry-run 模式下将改发 ${dryRunVersion}`);
    return dryRunVersion;
  }

  if (overwrite) {
    return version;
  }

  if (!bumpType) {
    throw new Error(
      `远端版本 ${version} 已存在。可使用 --overwrite 重新部署，或使用 --bump-if-exists=patch|minor|major 自动升级版本。`
    );
  }

  let nextVersion = bumpVersion(version, bumpType);
  while (remoteVersionExists(config, nextVersion)) {
    nextVersion = bumpVersion(nextVersion, 'patch');
  }

  console.log(`⚠️  远端已存在 ${version}，自动升级到 ${nextVersion}`);
  spawnChecked('node', [
    'scripts/safe-version-bump.js',
    bumpType,
    `--target=${nextVersion}`,
  ]);
  return getPackageVersion();
}

function ensureBuilt(version, skipBuild) {
  const distDir = path.join(ROOT_DIR, 'dist/apps/web');

  if (skipBuild) {
    console.log('⏭️  跳过构建，复用现有 dist/apps/web');
    return;
  }

  console.log('🏗️  构建 web...');
  spawnChecked('pnpm', ['build:web']);

  const builtVersionPath = path.join(distDir, 'version.json');
  if (!fs.existsSync(builtVersionPath)) {
    throw new Error('构建产物缺少 dist/apps/web/version.json');
  }

  const builtVersion = JSON.parse(fs.readFileSync(builtVersionPath, 'utf8')).version;
  if (builtVersion !== version) {
    throw new Error(`构建产物版本不匹配: 期望 ${version}，实际 ${builtVersion}`);
  }
}

function createReleaseTarball(version) {
  const distDir = path.join(ROOT_DIR, 'dist/apps/web');
  const versionFile = path.join(distDir, 'version.json');
  if (!fs.existsSync(distDir) || !fs.existsSync(versionFile)) {
    throw new Error('未找到 dist/apps/web，请先构建');
  }

  const versionInfo = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  if (versionInfo.version !== version) {
    throw new Error(`dist/apps/web/version.json 版本不匹配: ${versionInfo.version}`);
  }

  const outputDir = path.join(ROOT_DIR, 'dist/releases');
  fs.mkdirSync(outputDir, { recursive: true });
  const tarPath = path.join(outputDir, `opentu-${version}.tar.gz`);
  if (fs.existsSync(tarPath)) {
    fs.rmSync(tarPath, { force: true });
  }

  execFileSync(
    'tar',
    ['-czf', tarPath, '-C', distDir, '.'],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    }
  );

  return tarPath;
}

function verifyRelease(config, version) {
  const baseUrl = String(config.RELEASE_VERIFY_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return;
  }

  const verifyUrls = [
    `${baseUrl}/`,
    `${baseUrl}/releases/${version}/`,
    `${baseUrl}/releases/${version}/deep/link/check`,
  ];

  for (const url of verifyUrls) {
    console.log(`🔎 校验 ${url}`);
    execFileSync('curl', ['-fsSIL', url], { cwd: ROOT_DIR, stdio: 'inherit' });
  }
}

function deployRelease(config, options) {
  let version = options.version || getPackageVersion();
  version = ensureReleaseVersion(
    config,
    version,
    options.bumpIfExists,
    options.dryRun,
    options.overwrite
  );

  console.log(`📦 发布版本: ${version}`);
  ensureBuilt(version, options.skipBuild);

  const tarPath = createReleaseTarball(version);
  const remoteTarPath = path.posix.join(
    config.RELEASE_REMOTE_TMP_DIR,
    path.basename(tarPath)
  );

  console.log(`📦 本地包: ${tarPath}`);
  console.log(`🛰️  远端包: ${remoteTarPath}`);

  if (options.dryRun) {
    console.log('🧪 dry-run 模式，不执行上传和远端命令');
    return;
  }

  copyFileToRemote(config, tarPath, remoteTarPath);
  runRemoteCommand(
    config,
    `${shellEscape(config.RELEASE_MANAGE_SCRIPT)} deploy ${shellEscape(
      version
    )} ${shellEscape(remoteTarPath)}`
  );
  runRemoteCommand(
    config,
    `${shellEscape(config.RELEASE_MANAGE_SCRIPT)} activate ${shellEscape(version)}`
  );
  runRemoteCommand(config, `rm -f ${shellEscape(remoteTarPath)}`);

  if (!options.skipVerify) {
    verifyRelease(config, version);
  }

  console.log(`✅ 已部署并激活 ${version}`);
}

function activateRelease(config, options) {
  const version = options.version;
  if (!version) {
    throw new Error('activate 需要指定版本号');
  }

  if (options.dryRun) {
    console.log(`🧪 dry-run: 将激活 ${version}`);
    return;
  }

  runRemoteCommand(
    config,
    `${shellEscape(config.RELEASE_MANAGE_SCRIPT)} activate ${shellEscape(version)}`
  );
  if (!options.skipVerify) {
    verifyRelease(config, version);
  }
}

function rollbackRelease(config, options) {
  let targetVersion = options.version;
  if (!targetVersion) {
    const versions = listRemoteVersions(config);
    const current = getRemoteCurrentVersion(config);
    const currentIndex = versions.indexOf(current);
    if (currentIndex <= 0) {
      throw new Error(`无法从当前版本 ${current || '(unknown)'} 推断可回滚版本`);
    }
    targetVersion = versions[currentIndex - 1];
  }

  console.log(`↩️  回滚到 ${targetVersion}`);
  activateRelease(config, {
    ...options,
    version: targetVersion,
  });
}

function listRelease(config, options) {
  if (options.dryRun) {
    console.log('🧪 dry-run: 将列出远端版本');
    return;
  }
  runRemoteCommand(config, `${shellEscape(config.RELEASE_MANAGE_SCRIPT)} list`);
}

function getRemoteProductionVersion(config) {
  const command = `readlink -f ${shellEscape(
    path.posix.join(config.RELEASES_DIR, 'production')
  )} | xargs -r basename`;
  return runRemoteCommand(config, command, { captureOutput: true });
}

function promoteRelease(config, options) {
  let version = options.version;
  if (!version) {
    version = getRemoteCurrentVersion(config);
    if (!version) {
      throw new Error('无法确定当前预发布版本，请通过 --version=x.x.x 指定');
    }
  }

  const productionVersion = getRemoteProductionVersion(config);
  if (productionVersion === version) {
    console.log(`ℹ️  生产环境已是 ${version}，无需操作`);
    return;
  }

  console.log(`🚀 推送到生产: ${version}`);
  if (productionVersion) {
    console.log(`   当前生产版本: ${productionVersion}`);
  }

  if (options.dryRun) {
    console.log('🧪 dry-run: 将更新 production 符号链接');
    return;
  }

  // 直接通过 SSH 更新 production 符号链接
  const releasePath = path.posix.join(config.RELEASES_DIR, version);
  const productionLink = path.posix.join(config.RELEASES_DIR, 'production');
  runRemoteCommand(
    config,
    `test -d ${shellEscape(releasePath)} && ln -sfn ${shellEscape(releasePath)} ${shellEscape(productionLink)}`
  );

  console.log(`✅ 生产环境已切换到 ${version}`);
}

function removeRelease(config, options) {
  const version = validateVersion(options.version);
  const releasePath = path.posix.join(config.RELEASES_DIR, version);
  const prereleaseVersion = getRemoteCurrentVersion(config);
  const productionVersion = getRemoteProductionVersion(config);

  if (version === prereleaseVersion) {
    throw new Error(`不能删除当前预发布版本 ${version}`);
  }
  if (version === productionVersion) {
    throw new Error(`不能删除当前生产版本 ${version}`);
  }
  if (!remoteVersionExists(config, version)) {
    throw new Error(`远端版本 ${version} 不存在`);
  }

  console.log(`🗑️  删除历史版本: ${version}`);
  if (options.dryRun) {
    console.log(`🧪 dry-run: 将删除 ${releasePath}`);
    return;
  }

  runRemoteCommand(
    config,
    [
      `test "$(readlink -f ${shellEscape(path.posix.join(config.RELEASES_DIR, 'current'))})" != ${shellEscape(releasePath)}`,
      `test "$(readlink -f ${shellEscape(path.posix.join(config.RELEASES_DIR, 'production'))})" != ${shellEscape(releasePath)}`,
      `find ${shellEscape(releasePath)} -depth -delete`,
      `test ! -e ${shellEscape(releasePath)}`,
    ].join(' && ')
  );
  console.log(`✅ 已删除历史版本 ${version}`);
}

function currentRelease(config, options) {
  if (options.dryRun) {
    console.log('🧪 dry-run: 将查询当前版本');
    return;
  }
  runRemoteCommand(config, `${shellEscape(config.RELEASE_MANAGE_SCRIPT)} current`);
  const productionVersion = getRemoteProductionVersion(config);
  if (productionVersion) {
    console.log(`生产版本 (opentu.ai): ${productionVersion}`);
  }
}

function main() {
  const config = loadEnvConfig();
  ensureRequiredConfig(config);
  const { command, options } = parseCliArgs(process.argv.slice(2));

  console.log(`🚀 Release 管理: ${command}`);
  console.log(
    `🖥️  目标服务器: ${config.RELEASE_USER}@${config.RELEASE_HOST}:${config.RELEASE_PORT}`
  );

  switch (command) {
    case 'deploy':
      deployRelease(config, options);
      break;
    case 'activate':
      activateRelease(config, options);
      break;
    case 'rollback':
      rollbackRelease(config, options);
      break;
    case 'promote':
      promoteRelease(config, options);
      break;
    case 'remove':
      removeRelease(config, options);
      break;
    case 'list':
      listRelease(config, options);
      break;
    case 'current':
      currentRelease(config, options);
      break;
    default:
      throw new Error(`不支持的命令: ${command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
