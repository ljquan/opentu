const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// 加载 .env 配置文件
function loadEnvConfig() {
  const envPath = path.join(__dirname, '../.env');
  const config = {
    DEPLOY_HOST: '',
    DEPLOY_USER: '',
    DEPLOY_PORT: '22',
    DEPLOY_SSH_KEY: '',
    DEPLOY_SSH_PASSWORD: '',
    DEPLOY_UPLOAD_DIR: '',
    DEPLOY_RELEASES_DIR: '',  // releases 目录，如果不设置则从 UPLOAD_DIR 推导
    DEPLOY_SCRIPT_PATH: '',
    DEPLOY_AUTO_DEPLOY: 'test'  // 默认部署到测试环境
  };

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#')) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (config.hasOwnProperty(key)) {
            config[key] = value;
          }
        }
      }
    });
  }

  return config;
}

// 检查 sshpass 是否安装
function checkSshpassInstalled() {
  try {
    execSync('which sshpass', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// 检查 rsync 是否安装
function checkRsyncInstalled() {
  try {
    execSync('which rsync', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// 构建 SSH 公共参数（消除重复逻辑）
function buildSSHAuth(config) {
  let prefix = '';
  let usePassword = false;
  const args = [];

  if (config.DEPLOY_SSH_PASSWORD) {
    if (checkSshpassInstalled()) {
      usePassword = true;
      prefix = `sshpass -p "${config.DEPLOY_SSH_PASSWORD}" `;
    }
  }

  if (config.DEPLOY_SSH_KEY && !usePassword) {
    const sshKeyPath = config.DEPLOY_SSH_KEY.startsWith('/')
      ? config.DEPLOY_SSH_KEY
      : path.join(process.env.HOME || '', config.DEPLOY_SSH_KEY.replace(/^~/, ''));
    if (fs.existsSync(sshKeyPath)) {
      args.push(`-i "${sshKeyPath}"`);
    }
  }

  args.push('-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null');

  return { prefix, usePassword, args };
}

// 构建 SSH 命令
function buildSSHCommand(config, remoteCmd) {
  const { prefix, usePassword, args } = buildSSHAuth(config);
  const portArg = config.DEPLOY_PORT && config.DEPLOY_PORT !== '22' ? `-p ${config.DEPLOY_PORT}` : '';
  return {
    command: `${prefix}ssh ${portArg} ${args.join(' ')} ${config.DEPLOY_USER}@${config.DEPLOY_HOST} "${remoteCmd}"`,
    usePassword,
  };
}

// 执行远程 SSH 命令（返回 stdout）
function execRemoteCommand(config, remoteCmd, options = {}) {
  const { command } = buildSSHCommand(config, remoteCmd);
  return execSync(command, { encoding: 'utf8', stdio: 'pipe', ...options }).trim();
}

// 预检远程目录：确保存在且可写
function ensureRemoteDir(config) {
  const dir = config.DEPLOY_UPLOAD_DIR;
  if (!dir) return { ok: false, reason: '未配置 DEPLOY_UPLOAD_DIR' };

  try {
    const result = execRemoteCommand(config,
      `mkdir -p ${dir} 2>/dev/null; test -w ${dir} && echo 'writable' || echo 'not_writable'`
    );
    if (result === 'writable') return { ok: true };

    // 尝试修复权限（如果用户有 sudo）
    try {
      execRemoteCommand(config, `sudo chown -R $(whoami) ${dir} 2>/dev/null && echo ok`);
      const retry = execRemoteCommand(config, `test -w ${dir} && echo 'writable' || echo 'not_writable'`);
      if (retry === 'writable') {
        console.log(`🔧 已自动修复目录权限`);
        return { ok: true };
      }
    } catch (_) { /* sudo 不可用，忽略 */ }

    return {
      ok: false,
      reason: `目录 ${dir} 不可写`,
      fix: `ssh root@${config.DEPLOY_HOST} "chown -R ${config.DEPLOY_USER}:${config.DEPLOY_USER} ${dir} && chmod 755 ${dir}"`,
    };
  } catch (error) {
    return { ok: false, reason: `SSH 连接失败: ${error.message}` };
  }
}

// 查找最新的打包文件
function findLatestPackage() {
  const distPath = path.join(__dirname, '../dist/apps');
  
  if (!fs.existsSync(distPath)) {
    console.error(`❌ 构建目录不存在: ${distPath}`);
    console.error(`   请先运行 npm run deploy:package 打包`);
    process.exit(1);
  }

  // 查找所有 tar.gz 文件
  const files = fs.readdirSync(distPath)
    .filter(file => file.startsWith('web-') && file.endsWith('.tar.gz'))
    .map(file => {
      const filePath = path.join(distPath, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        path: filePath,
        mtime: stats.mtime
      };
    })
    .sort((a, b) => b.mtime - a.mtime); // 按修改时间排序，最新的在前

  if (files.length === 0) {
    console.error(`❌ 未找到打包文件`);
    console.error(`   请先运行 npm run deploy:package 打包`);
    process.exit(1);
  }

  return files[0];
}

// 检查远程文件是否存在
function checkRemoteFileExists(tarName, config) {
  if (!config.DEPLOY_UPLOAD_DIR) return false;
  try {
    const result = execRemoteCommand(config,
      `test -f ${config.DEPLOY_UPLOAD_DIR}/${tarName} && echo 'exists' || echo 'not_exists'`
    );
    return result === 'exists';
  } catch (error) {
    return false;
  }
}

// 计算本地文件的哈希
function calculateLocalFileHash(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    return hash;
  } catch (error) {
    return null;
  }
}

// 获取远程文件的哈希
function getRemoteFileHash(tarName, config) {
  if (!config.DEPLOY_UPLOAD_DIR) return null;
  try {
    const hash = execRemoteCommand(config,
      `sha256sum ${config.DEPLOY_UPLOAD_DIR}/${tarName} 2>/dev/null | cut -d' ' -f1 || echo ''`
    );
    return hash || null;
  } catch (error) {
    return null;
  }
}

// 上传文件到远程服务器（rsync 优先，scp 降级）
function uploadToServer(tarPath, tarName, config, localHash = null) {
  if (!config.DEPLOY_UPLOAD_DIR) {
    console.error(`\n❌ 未配置上传目录`);
    console.error(`   请在 .env 文件中配置 DEPLOY_UPLOAD_DIR`);
    return false;
  }

  // 预检远程目录
  console.log(`\n🔍 预检远程目录...`);
  const dirCheck = ensureRemoteDir(config);
  if (!dirCheck.ok) {
    console.error(`\n❌ ${dirCheck.reason}`);
    if (dirCheck.fix) {
      console.error(`\n💡 修复命令:\n   ${dirCheck.fix}`);
    }
    return false;
  }
  console.log(`   目录可写 ✓`);

  // 计算本地文件哈希
  if (!localHash) {
    console.log(`\n🔐 计算本地文件哈希...`);
    localHash = calculateLocalFileHash(tarPath);
    if (localHash) {
      console.log(`   本地哈希: ${localHash.substring(0, 16)}...`);
    }
  }

  // 检查远程文件是否存在并比较哈希
  console.log(`\n🔍 检查远程文件...`);
  const remoteHash = getRemoteFileHash(tarName, config);

  if (remoteHash) {
    console.log(`   远程哈希: ${remoteHash.substring(0, 16)}...`);
    if (localHash && remoteHash === localHash) {
      console.log(`✅ 远程文件已存在且哈希匹配，跳过上传`);
      return { success: true, tarName, usePassword: false, skipped: true, hash: localHash };
    } else {
      console.log(`⚠️  远程文件存在但哈希不匹配，将重新上传`);
    }
  } else {
    console.log(`   远程文件不存在，需要上传`);
  }

  const fileSizeMB = (fs.statSync(tarPath).size / 1024 / 1024).toFixed(2);
  console.log(`\n🚀 开始上传到远程服务器...`);
  console.log(`   服务器: ${config.DEPLOY_USER}@${config.DEPLOY_HOST}:${config.DEPLOY_PORT}`);
  console.log(`   目标目录: ${config.DEPLOY_UPLOAD_DIR}`);
  console.log(`   文件: ${tarName} (${fileSizeMB} MB)`);

  const { prefix, usePassword, args } = buildSSHAuth(config);
  const remoteDest = `${config.DEPLOY_USER}@${config.DEPLOY_HOST}:${config.DEPLOY_UPLOAD_DIR}/`;

  // 优先尝试 rsync（进度显示 + 压缩 + 断点续传）
  if (checkRsyncInstalled()) {
    try {
      console.log(`🔄 使用 rsync 上传（支持断点续传）...`);
      const portArg = config.DEPLOY_PORT && config.DEPLOY_PORT !== '22' ? config.DEPLOY_PORT : '22';
      const sshOpts = `ssh -p ${portArg} ${args.join(' ')}`;
      const rsyncCmd = `${prefix}rsync -avz --progress --partial -e '${sshOpts}' "${tarPath}" "${remoteDest}"`;
      execSync(rsyncCmd, { stdio: 'inherit' });
      console.log(`✅ rsync 上传成功!`);
      console.log(`📦 远程路径: ${config.DEPLOY_UPLOAD_DIR}/${tarName}`);
      return { success: true, tarName, usePassword };
    } catch (error) {
      console.log(`⚠️  rsync 失败，降级到 scp...`);
    }
  }

  // scp 降级
  try {
    console.log(`🔄 使用 scp 上传...`);
    let scpCmd = `${prefix}scp`;
    if (config.DEPLOY_PORT && config.DEPLOY_PORT !== '22') {
      scpCmd += ` -P ${config.DEPLOY_PORT}`;
    }
    scpCmd += ` ${args.join(' ')} "${tarPath}" "${remoteDest}"`;
    execSync(scpCmd, { stdio: 'inherit' });
    console.log(`✅ scp 上传成功!`);
    console.log(`📦 远程路径: ${config.DEPLOY_UPLOAD_DIR}/${tarName}`);
    return { success: true, tarName, usePassword };
  } catch (error) {
    console.error(`❌ 上传失败:`, error.message);
    if (error.message.includes('Permission denied')) {
      console.error(`\n💡 权限不足，请在服务器执行:`);
      console.error(`   chown -R ${config.DEPLOY_USER}:${config.DEPLOY_USER} ${config.DEPLOY_UPLOAD_DIR}`);
    }
    return false;
  }
}

// 执行远程解压（只解压，不部署）
function executeRemoteExtract(config, tarName, usePassword = false) {
  if (!config.DEPLOY_UPLOAD_DIR) {
    console.error(`\n❌ 未配置上传目录`);
    return false;
  }

  const uploadsDir = config.DEPLOY_UPLOAD_DIR;
  const releasesDir = config.DEPLOY_RELEASES_DIR || uploadsDir.replace('/uploads', '/releases');

  console.log(`\n📦 开始远程解压...`);
  console.log(`   包文件: ${tarName}`);
  console.log(`   解压目录: ${releasesDir}`);

  try {
    const extractScript = `VERSION=$(tar -xzf ${uploadsDir}/${tarName} -O web/version.json 2>/dev/null | grep '"version"' | sed 's/.*"version": "\\([^"]*\\)".*/\\1/')
if [ -z "$VERSION" ]; then
  echo "无法读取版本号"
  exit 1
fi
echo "版本: $VERSION"
if [ -d "${releasesDir}/$VERSION" ]; then
  echo "删除旧版本目录..."
  rm -rf "${releasesDir}/$VERSION"
fi
mkdir -p "${releasesDir}/$VERSION"
echo "开始解压..."
tar -xzf ${uploadsDir}/${tarName} -C "${releasesDir}/$VERSION" --strip-components=1
echo "解压完成: ${releasesDir}/$VERSION"
if [ -f "${releasesDir}/$VERSION/version.json" ] && [ -d "${releasesDir}/$VERSION/assets" ]; then
  FILE_COUNT=$(find "${releasesDir}/$VERSION" -type f | wc -l)
  ASSETS_JS_COUNT=$(find "${releasesDir}/$VERSION/assets" -type f -name "*.js" | wc -l)
  echo "解压验证: $FILE_COUNT 个文件，$ASSETS_JS_COUNT 个 JS 文件"
  if [ "$ASSETS_JS_COUNT" -lt 50 ]; then
    echo "警告: JS 文件数量较少，可能不完整"
  fi
else
  echo "解压验证失败"
  exit 1
fi
cp "${releasesDir}/$VERSION/versions.html" "${releasesDir}/versions.html" 2>/dev/null || true
cp "${releasesDir}/$VERSION/changelog.json" "${releasesDir}/changelog.json" 2>/dev/null || true`;

    const encodedScript = Buffer.from(extractScript).toString('base64');
    const { command } = buildSSHCommand(config, `echo ${encodedScript} | base64 -d | bash`);

    console.log(`🔄 执行远程解压命令...`);
    execSync(command, { stdio: 'inherit' });

    console.log(`✅ 解压成功!`);
    return true;
  } catch (error) {
    console.error(`❌ 解压失败:`, error.message);
    console.error(`\n💡 请检查:`);
    console.error(`   1. 包文件是否存在: ${uploadsDir}/${tarName}`);
    console.error(`   2. 服务器目录权限是否正确`);
    console.error(`   3. 磁盘空间是否充足`);
    return false;
  }
}

// 执行远程部署脚本
function executeRemoteDeploy(config, tarName, env = 'test', usePassword = false) {
  if (!config.DEPLOY_SCRIPT_PATH) {
    console.error(`\n❌ 未配置部署脚本路径`);
    return false;
  }

  const deployScriptPath = config.DEPLOY_SCRIPT_PATH;
  console.log(`\n🚀 开始自动部署到${env === 'test' ? '测试' : '生产'}环境...`);
  console.log(`   部署脚本: ${deployScriptPath}`);
  console.log(`   包文件: ${tarName}`);

  try {
    const remoteCommand = `bash ${deployScriptPath} --${env} ${tarName}`;
    const { command } = buildSSHCommand(config, remoteCommand);

    console.log(`🔄 执行远程部署命令...`);
    execSync(command, { stdio: 'inherit' });

    console.log(`✅ 部署成功!`);
    return true;
  } catch (error) {
    console.error(`❌ 部署失败:`, error.message);
    console.error(`\n💡 请检查:`);
    console.error(`   1. 部署脚本路径是否正确: ${deployScriptPath}`);
    console.error(`   2. 脚本是否有执行权限`);
    console.error(`   3. 服务器目录权限是否正确`);
    return false;
  }
}

// 获取认证方式（用于后续的部署命令）
function getAuthInfo(config) {
  let usePassword = false;
  
  if (config.DEPLOY_SSH_PASSWORD) {
    if (checkSshpassInstalled()) {
      usePassword = true;
    }
  }
  
  return { usePassword };
}

// 主函数
function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  const env = args.includes('--prod') ? 'prod' : (args.includes('--test') ? 'test' : 'test');
  const skipDeploy = args.includes('--no-deploy');
  const deployOnly = args.includes('--deploy-only') || args.includes('--only-deploy');
  
  console.log(`🚀 上传并部署工具`);
  console.log(`⏰ 时间: ${new Date().toLocaleString()}`);
  console.log(`───────────────────────────────────`);
  
  // 加载配置
  const config = loadEnvConfig();
  
  // 检查配置
  if (!config.DEPLOY_HOST || !config.DEPLOY_USER) {
    console.error(`❌ 未配置服务器信息`);
    console.error(`   请在 .env 文件中配置 DEPLOY_HOST 和 DEPLOY_USER`);
    process.exit(1);
  }
  
  // 查找最新的打包文件
  console.log(`\n📦 查找最新的打包文件...`);
  const packageFile = findLatestPackage();
  console.log(`✅ 找到文件: ${packageFile.name}`);
  console.log(`   路径: ${packageFile.path}`);
  console.log(`   大小: ${(fs.statSync(packageFile.path).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   修改时间: ${packageFile.mtime.toLocaleString()}`);
  
  let uploadResult = null;
  let fileExists = false;
  
  // 如果使用 --deploy-only，检查远程文件是否存在
  if (deployOnly) {
    console.log(`\n🔍 检查远程文件是否存在...`);
    fileExists = checkRemoteFileExists(packageFile.name, config);
    
    if (fileExists) {
      console.log(`✅ 远程文件已存在: ${config.DEPLOY_UPLOAD_DIR}/${packageFile.name}`);
      console.log(`   跳过上传，直接部署`);
      uploadResult = getAuthInfo(config);
      uploadResult.success = true;
      uploadResult.tarName = packageFile.name;
    } else {
      console.error(`❌ 远程文件不存在: ${config.DEPLOY_UPLOAD_DIR}/${packageFile.name}`);
      console.error(`   请先上传文件或移除 --deploy-only 参数`);
      process.exit(1);
    }
  } else {
    // 上传文件（内部已处理哈希比对和跳过逻辑）
    uploadResult = uploadToServer(packageFile.path, packageFile.name, config);

    if (!uploadResult || !uploadResult.success) {
      console.error(`\n❌ 上传失败，终止部署`);
      process.exit(1);
    }
  }
  
  // 执行部署或解压
  if (!skipDeploy) {
    // 如果使用 --prod，只解压不部署
    if (env === 'prod') {
      console.log(`\n📦 生产环境模式：只解压，不部署`);
      const extractSuccess = executeRemoteExtract(
        config,
        packageFile.name,
        uploadResult.usePassword
      );
      
      if (!extractSuccess) {
        console.error(`\n❌ 解压失败`);
        process.exit(1);
      }
    } else {
      // 测试环境或其他环境，执行完整部署
      const deployEnv = config.DEPLOY_AUTO_DEPLOY === 'prod' ? 'prod' : env;
      const deploySuccess = executeRemoteDeploy(
        config, 
        packageFile.name, 
        deployEnv,
        uploadResult.usePassword
      );
      
      if (!deploySuccess) {
        console.error(`\n❌ 部署失败`);
        process.exit(1);
      }
    }
  } else {
    console.log(`\n💡 已跳过自动部署（使用 --no-deploy 参数）`);
    console.log(`   可以在服务器上手动运行:`);
    if (config.DEPLOY_SCRIPT_PATH) {
      console.log(`   ${config.DEPLOY_SCRIPT_PATH} --${env} ${packageFile.name}`);
    } else {
      console.log(`   部署脚本 --${env} ${packageFile.name}`);
    }
  }
  
  console.log(`───────────────────────────────────`);
  console.log(`🎊 完成!`);
  console.log(`\n💡 使用方法:`);
  console.log(`   npm run deploy:upload              # 上传并部署到测试环境`);
  console.log(`   npm run deploy:upload -- --prod     # 上传并解压到生产环境（不部署）`);
  console.log(`   npm run deploy:upload -- --test    # 上传并部署到测试环境`);
  console.log(`   npm run deploy:upload -- --no-deploy # 只上传，不解压也不部署`);
  console.log(`   npm run deploy:upload -- --deploy-only # 只部署，不上传（文件需已存在）`);
}

main();
