const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

function getNextVersion(currentVersion, type = 'patch') {
  const parts = currentVersion.split('.').map(Number);
  
  switch (type) {
    case 'major':
      parts[0]++;
      parts[1] = 0;
      parts[2] = 0;
      break;
    case 'minor':
      parts[1]++;
      parts[2] = 0;
      break;
    case 'patch':
    default:
      parts[2]++;
      break;
  }
  
  return parts.join('.');
}

function isValidVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function compareVersions(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (aParts[i] > bParts[i]) return 1;
    if (aParts[i] < bParts[i]) return -1;
  }

  return 0;
}

function tagExists(version) {
  try {
    execSync(`git tag -l | grep -q "^v${version}$"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function findNextAvailableVersion(baseVersion, type) {
  let version = getNextVersion(baseVersion, type);
  
  // 如果 tag 已存在，继续递增直到找到可用的版本号
  while (tagExists(version)) {
    console.log(`⚠️  版本 v${version} 已存在，尝试下一个版本...`);
    version = getNextVersion(version, 'patch'); // 总是递增 patch 版本
  }
  
  return version;
}

function updatePackageVersion(newVersion) {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  packageJson.version = newVersion;
  fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
}

// 更新 Service Worker 中的版本号（已废弃，sw.js 现在是构建产物）
function updateServiceWorkerVersion(version) {
  // sw.js 现在是构建产物，不再需要手动更新
  // 版本信息会通过 version.json 和构建过程自动处理
  console.log(`ℹ️  Service Worker 版本将通过构建过程自动更新`);
}

// 计算两个字符串的相似度 (Jaccard Index based on characters)
function calculateSimilarity(str1, str2) {
  const set1 = new Set(str1.split(''));
  const set2 = new Set(str2.split(''));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

// 创建版本信息文件
function createVersionFile(version, commits) {
  let changelog = [];
  if (commits) {
    // 过滤掉用户无感的提交类型 (docs, test, style, refactor, ci, build, revert)
    const irrelevantRegex = /^(docs|test|style|refactor|ci|build|revert|chore)(\(.*?\))?:/i;
    const relevantOthers = commits.others.filter(c => !c.message.match(irrelevantRegex));

    const allCommits = [
      ...commits.features,
      ...commits.fixes,
      // ...commits.chores, // 排除 chores
      ...relevantOthers
    ];
    
    // 1. 过滤出有意义的提交消息（汉字 > 5 个 或 英文单词 > 5 个）
    const filteredCommits = allCommits
      .filter(c => {
        const chineseChars = c.message.match(/[\u4e00-\u9fa5]/g) || [];
        // 提取英文单词（排除常见的 commit 前缀如 feat/fix/chore 等）
        const cleanMessage = c.message.replace(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?:\s*/i, '');
        const englishWords = cleanMessage.match(/[a-zA-Z]{2,}/g) || [];
        return chineseChars.length > 5 || englishWords.length > 5;
      })
      .map(c => c.message);

    // 2. 按长度降序排序（文字多的优先级高）
    filteredCommits.sort((a, b) => b.length - a.length);

    // 3. 去重和过滤相似消息
    const uniqueChangelog = [];
    for (const msg of filteredCommits) {
      let isSimilar = false;
      for (const existingMsg of uniqueChangelog) {
        // 如果包含关系（忽略大小写和空格）
        if (existingMsg.toLowerCase().replace(/\s/g, '').includes(msg.toLowerCase().replace(/\s/g, ''))) {
          isSimilar = true;
          break;
        }
        
        // 如果相似度超过 0.6 (60% 相似)
        if (calculateSimilarity(msg, existingMsg) > 0.6) {
          isSimilar = true;
          break;
        }
      }
      
      if (!isSimilar) {
        uniqueChangelog.push(msg);
      }
    }

    changelog = uniqueChangelog;
  }

  const versionInfo = {
    version: version,
    buildTime: new Date().toISOString(),
    gitCommit: process.env.GITHUB_SHA || 'unknown',
    changelog: changelog
  };

  const versionPath = path.join(__dirname, '../apps/web/public/version.json');
  fs.writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2));
  console.log(`✅ 版本信息文件已创建: ${version} (包含 ${changelog.length} 条更新日志)`);
}

// 获取上一个版本号
function getPreviousVersion(currentVersion) {
  try {
    // 尝试获取上一个版本的 tag
    const tags = execSync('git tag --sort=-version:refname', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(tag => tag.startsWith('v'));

    // 找到当前版本之前的版本
    const currentTag = `v${currentVersion}`;
    const currentIndex = tags.indexOf(currentTag);

    if (currentIndex > 0 && currentIndex < tags.length) {
      return tags[currentIndex + 1].substring(1); // 移除 'v' 前缀
    }

    // 如果找不到，返回最新的 tag
    if (tags.length > 0) {
      return tags[0].substring(1);
    }
  } catch (error) {
    console.warn('⚠️  无法获取上一个版本:', error.message);
  }

  return null;
}

// 获取提交记录并分类
function getCommitsSinceLastVersion(lastVersion) {
  try {
    let gitCommand;
    if (lastVersion) {
      gitCommand = `git log v${lastVersion}..HEAD --pretty=format:"%s|||%h|||%an|||%ae" --no-merges`;
    } else {
      // 如果没有上一个版本，获取最近20条提交
      gitCommand = `git log -20 --pretty=format:"%s|||%h|||%an|||%ae" --no-merges`;
    }

    const commits = execSync(gitCommand, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(line => line.length > 0);

    // 分类提交
    const categorized = {
      features: [],
      fixes: [],
      chores: [],
      others: [],
      authors: new Set()
    };

    commits.forEach(commit => {
      const [message, hash, authorName, authorEmail] = commit.split('|||');

      // 收集作者信息
      categorized.authors.add(`${authorName} <${authorEmail}>`);

      // 根据 conventional commits 规范分类
      if (message.match(/^feat(\(.*?\))?:/i)) {
        categorized.features.push({ message: message.replace(/^feat(\(.*?\))?:\s*/i, ''), hash });
      } else if (message.match(/^fix(\(.*?\))?:/i)) {
        categorized.fixes.push({ message: message.replace(/^fix(\(.*?\))?:\s*/i, ''), hash });
      } else if (message.match(/^chore(\(.*?\))?:/i)) {
        categorized.chores.push({ message: message.replace(/^chore(\(.*?\))?:\s*/i, ''), hash });
      } else {
        categorized.others.push({ message, hash });
      }
    });

    return categorized;
  } catch (error) {
    console.warn('⚠️  无法获取提交记录:', error.message);
    return null;
  }
}

// 更新 CHANGELOG.md
function updateChangelog(version, commits) {
  const changelogPath = path.join(__dirname, '../CHANGELOG.md');
  const date = new Date().toISOString().split('T')[0];

  // 构建新的 changelog 条目
  let newEntry = `## ${version} (${date})\n\n`;

  // 添加功能
  if (commits.features.length > 0) {
    newEntry += `### 🚀 Features\n\n`;
    commits.features.forEach(({ message, hash }) => {
      newEntry += `- ${message} ([${hash}](https://github.com/ljquan/opentu/commit/${hash}))\n`;
    });
    newEntry += '\n';
  }

  // 添加修复
  if (commits.fixes.length > 0) {
    newEntry += `### 🩹 Fixes\n\n`;
    commits.fixes.forEach(({ message, hash }) => {
      newEntry += `- ${message} ([${hash}](https://github.com/ljquan/opentu/commit/${hash}))\n`;
    });
    newEntry += '\n';
  }

  // 添加其他更改
  if (commits.chores.length > 0 || commits.others.length > 0) {
    newEntry += `### 🔧 Chores\n\n`;
    [...commits.chores, ...commits.others].forEach(({ message, hash }) => {
      newEntry += `- ${message} ([${hash}](https://github.com/ljquan/opentu/commit/${hash}))\n`;
    });
    newEntry += '\n';
  }

  // 添加贡献者
  if (commits.authors.size > 0) {
    newEntry += `### ❤️  Thank You\n\n`;
    Array.from(commits.authors).forEach(author => {
      newEntry += `- ${author}\n`;
    });
    newEntry += '\n';
  }

  // 读取现有 CHANGELOG
  let changelogContent = '';
  if (fs.existsSync(changelogPath)) {
    changelogContent = fs.readFileSync(changelogPath, 'utf8');
  }

  // 插入新条目到文件开头
  const updatedChangelog = newEntry + changelogContent;
  fs.writeFileSync(changelogPath, updatedChangelog);

  console.log(`✅ CHANGELOG.md 已更新`);
}

function main() {
  const versionType = process.argv[2] || 'patch';
  const targetArg = process.argv.find(arg => arg.startsWith('--target='));
  const targetVersion = targetArg ? targetArg.slice('--target='.length) : null;
  
  try {
    const currentVersion = getCurrentVersion();
    console.log(`📦 当前版本: ${currentVersion}`);
    
    if (targetVersion && !isValidVersion(targetVersion)) {
      throw new Error(`目标版本格式无效: ${targetVersion}`);
    }
    if (targetVersion && compareVersions(targetVersion, currentVersion) <= 0) {
      throw new Error(`目标版本必须大于当前版本: ${currentVersion} → ${targetVersion}`);
    }

    const nextVersion = targetVersion || findNextAvailableVersion(currentVersion, versionType);
    console.log(`🚀 升级到版本: ${nextVersion}`);
    
    // 更新 package.json
    updatePackageVersion(nextVersion);
    console.log(`✅ package.json 已更新到 ${nextVersion}`);

    // 更新 Service Worker 版本
    updateServiceWorkerVersion(nextVersion);

    // 获取并更新 CHANGELOG
    const previousVersion = getPreviousVersion(currentVersion);
    console.log(`📝 从版本 ${previousVersion || '开始'} 收集提交记录...`);

    const commits = getCommitsSinceLastVersion(previousVersion);

    // 创建版本信息文件
    createVersionFile(nextVersion, commits);

    if (commits && (commits.features.length > 0 || commits.fixes.length > 0 || commits.chores.length > 0 || commits.others.length > 0)) {
      updateChangelog(nextVersion, commits);
    } else {
      console.log(`ℹ️  没有找到提交记录，跳过 CHANGELOG 更新`);
    }

    // 同步 CHANGELOG.md → changelog.json
    try {
      require('./sync-changelog')();
    } catch (error) {
      console.warn(`⚠️  同步 changelog.json 失败:`, error.message);
    }

    // 提交更改
    try {
      // 检查是否存在 package-lock.json 或 pnpm-lock.yaml
      const filesToAdd = ['package.json', 'apps/web/public/version.json', 'CHANGELOG.md', 'apps/web/public/changelog.json'];
      if (fs.existsSync('package-lock.json')) {
        filesToAdd.push('package-lock.json');
      } else if (fs.existsSync('pnpm-lock.yaml')) {
        filesToAdd.push('pnpm-lock.yaml');
      }
      
      execSync(`git add ${filesToAdd.join(' ')}`, { stdio: 'inherit' });
      execSync(`git commit -m "chore: bump version to ${nextVersion}"`, { stdio: 'inherit' });
      console.log(`✅ 版本更改已提交`);
    } catch (error) {
      console.log(`ℹ️  跳过 git 提交（可能没有更改或不在 git 仓库中）`);
    }
    
    // 创建 tag
    try {
      execSync(`git tag -a v${nextVersion} -m "Release ${nextVersion}"`, { stdio: 'inherit' });
      console.log(`✅ 创建 git tag: v${nextVersion}`);
    } catch (error) {
      console.log(`⚠️  创建 git tag 失败: ${error.message}`);
    }
    
    console.log(`\n🎉 版本升级完成: ${currentVersion} → ${nextVersion}`);
    
  } catch (error) {
    console.error(`❌ 版本升级失败:`, error.message);
    process.exit(1);
  }
}

main();
