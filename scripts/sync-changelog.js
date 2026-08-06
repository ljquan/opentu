/**
 * sync-changelog.js
 * 解析 CHANGELOG.md 生成 apps/web/public/changelog.json
 *
 * 用法：
 *   node scripts/sync-changelog.js          # 独立运行
 *   require('./sync-changelog')()           # 在其他脚本中调用
 */

const fs = require('fs');
const path = require('path');

const MAX_CHANGELOG_VERSIONS = 50;

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function detectType(version, prevVersion) {
  if (!prevVersion) return 'patch';
  const [aMaj, aMin] = version.split('.').map(Number);
  const [bMaj, bMin] = prevVersion.split('.').map(Number);
  if (aMaj !== bMaj) return 'major';
  if (aMin !== bMin) return 'minor';
  return 'patch';
}

// 去掉行末 commit hash 链接，如 ([abc1234](https://...))
function stripCommitLink(line) {
  return line.replace(/\s*\(\[[a-f0-9]+\]\([^)]+\)\)\s*$/, '').trim();
}

// 判断条目是否为噪音（对用户无价值）
function isNoiseEntry(text) {
  // 版本号 bump
  if (/^(bump|update)\s+(app\s+)?version\s+to\s/i.test(text)) return true;
  if (/^更新(应用)?版本至/i.test(text)) return true;
  // docs 类（CLAUDE.md、编码规则等）
  if (/^docs(\(.*?\))?:/i.test(text)) return true;
  // 纯 refactor/style/ci/build/test/revert 前缀
  if (/^(refactor|style|ci|build|test|revert)(\(.*?\))?:/i.test(text)) return true;
  // 更新 build time
  if (/update.*build\s*time/i.test(text)) return true;
  // 过短无意义（如 "升级"、"ppt"、"简化方案"）
  if (text.length <= 4) return true;
  // 纯英文的内部优化描述（enhance/improve/optimize/unify 开头，不含中文）
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  if (!hasChinese && /^(enhance|improve|optimize|unify)\s/i.test(text)) return true;
  return false;
}

function parseChangelog(content) {
  const versions = [];
  // 按 ## VERSION (DATE) 分割
  const versionRegex = /^## (\d+\.\d+\.\d+)\s+\((\d{4}-\d{2}-\d{2})\)/;
  const sectionRegex = /^### (.+)/;

  const lines = content.split('\n');
  let current = null;
  let currentSection = null;

  for (const line of lines) {
    const vMatch = line.match(versionRegex);
    if (vMatch) {
      if (current) versions.push(current);
      current = {
        version: vMatch[1],
        date: vMatch[2],
        changes: { features: [], fixes: [], improvements: [] },
      };
      currentSection = null;
      continue;
    }

    if (!current) continue;

    const withdrawalMatch = line.match(/^> \*\*撤回说明[:：]\*\*\s*(.+)$/);
    if (withdrawalMatch) {
      current.status = 'withdrawn';
      current.withdrawalReason = withdrawalMatch[1].trim();
      continue;
    }

    const sMatch = line.match(sectionRegex);
    if (sMatch) {
      const title = sMatch[1].trim();
      if (/Thank You/i.test(title)) {
        currentSection = null; // 跳过 Thank You 段落
      } else if (/Features/i.test(title)) {
        currentSection = 'features';
      } else if (/Fixes/i.test(title)) {
        currentSection = 'fixes';
      } else if (/Chores|Improvements/i.test(title)) {
        currentSection = 'improvements';
      } else {
        currentSection = null;
      }
      continue;
    }

    // 解析列表项
    const itemMatch = line.match(/^- (.+)/);
    if (itemMatch && currentSection && current.changes[currentSection]) {
      const text = stripCommitLink(itemMatch[1]);
      if (text) {
        current.changes[currentSection].push(text);
      }
    }
  }

  if (current) versions.push(current);

  // 按版本号降序排列
  versions.sort((a, b) => compareSemver(b.version, a.version));

  // 计算 type 和 highlights
  for (let i = 0; i < versions.length; i++) {
    const prev = i < versions.length - 1 ? versions[i + 1].version : null;
    versions[i].type = detectType(versions[i].version, prev);

    // 过滤噪音条目
    const c = versions[i].changes;
    c.features = c.features.filter(t => !isNoiseEntry(t));
    c.fixes = c.fixes.filter(t => !isNoiseEntry(t));
    c.improvements = c.improvements.filter(t => !isNoiseEntry(t));

    const { features, fixes } = c;
    versions[i].highlights =
      (features.length > 0 && features[0]) ||
      (fixes.length > 0 && fixes[0]) ||
      '构建修复与稳定性改进';

    // 清理空的 changes
    if (!c.features.length && !c.fixes.length && !c.improvements.length) {
      delete versions[i].changes;
    }
  }

  return { versions: versions.slice(0, MAX_CHANGELOG_VERSIONS) };
}

function syncChangelog() {
  const changelogPath = path.join(__dirname, '../CHANGELOG.md');
  const outputPath = path.join(__dirname, '../apps/web/public/changelog.json');

  if (!fs.existsSync(changelogPath)) {
    console.log('ℹ️  CHANGELOG.md 不存在，跳过同步');
    return;
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  const data = parseChangelog(content);

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n');
  console.log(
    `✅ changelog.json 已同步（${data.versions.length} 个版本，最多保留 ${MAX_CHANGELOG_VERSIONS} 个）`
  );
}

// 支持独立运行和 require() 调用
if (require.main === module) {
  syncChangelog();
} else {
  module.exports = syncChangelog;
}
