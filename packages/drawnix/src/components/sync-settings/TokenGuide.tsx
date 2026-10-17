/**
 * Token 创建引导组件
 */

import React from 'react';
import { Dialog, Button } from 'tdesign-react';
import { LinkIcon } from 'tdesign-icons-react';
import { tokenService } from '../../services/github-sync';
import './token-guide.scss';

/** Props */
interface TokenGuideProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Token 创建引导
 */
export function TokenGuide({ visible, onClose }: TokenGuideProps) {
  const tokenCreationUrl = tokenService.getTokenCreationUrl();

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      header="如何获取 GitHub Token"
      footer={
        <Button theme="primary" onClick={onClose}>
          我知道了
        </Button>
      }
      width={520}
      className="token-guide-dialog"
    >
      <div className="token-guide">
        <div className="token-guide__steps">
          <div className="token-guide__step">
            <div className="token-guide__step-number">1</div>
            <div className="token-guide__step-content">
              <h4>打开 GitHub Token 设置页面</h4>
              <p>点击下方按钮，将跳转到 GitHub 的 Token 创建页面。</p>
              <a
                href={tokenCreationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="token-guide__link"
              >
                <LinkIcon />
                打开 GitHub Token 设置
              </a>
            </div>
          </div>

          <div className="token-guide__step">
            <div className="token-guide__step-number">2</div>
            <div className="token-guide__step-content">
              <h4>填写 Token 信息</h4>
              <ul className="token-guide__list">
                <li>
                  <strong>Note:</strong> 保持默认的 <code>FoxVue Sync + 日期</code>（以便区分）
                </li>
                <li>
                  <strong>Expiration:</strong> 建议选择 <code>No expiration</code>（永不过期）
                </li>
                <li>
                  <strong>Select scopes:</strong> 勾选 <code>gist</code> 权限
                </li>
              </ul>
            </div>
          </div>

          <div className="token-guide__step">
            <div className="token-guide__step-number">3</div>
            <div className="token-guide__step-content">
              <h4>生成并复制 Token</h4>
              <p>
                点击 <strong>Generate token</strong> 按钮，然后复制生成的 Token。
              </p>
              <div className="token-guide__warning">
                ⚠️ Token 只会显示一次，请务必复制保存！
              </div>
            </div>
          </div>

          <div className="token-guide__step">
            <div className="token-guide__step-number">4</div>
            <div className="token-guide__step-content">
              <h4>粘贴到同步设置</h4>
              <p>将复制的 Token 粘贴到同步设置的输入框中，点击"连接"即可。</p>
            </div>
          </div>
        </div>

        <div className="token-guide__security">
          <h4>⚠️ 隐私须知</h4>
          <ul className="token-guide__security-list">
            <li>
              <strong>Secret Gist：</strong>数据存储在 Secret Gist 中，不会被搜索引擎索引
            </li>
            <li>
              <strong className="token-guide__warning-text">注意：</strong>
              <span className="token-guide__warning-text">知道 Gist 链接的人仍可访问，请勿存储敏感信息</span>
            </li>
            <li>
              <strong>最小权限：</strong>Token 只需要 <code>gist</code> 权限，不会访问您的代码仓库
            </li>
            <li>
              <strong>Token 加密：</strong>Token 使用 AES-256 加密存储在浏览器本地
            </li>
            <li>
              <strong>可随时撤销：</strong>您可以随时在 GitHub 设置中撤销 Token
            </li>
          </ul>
        </div>

        <div className="token-guide__faq">
          <h4>常见问题</h4>
          <div className="token-guide__faq-item">
            <strong>Token 会过期吗？</strong>
            <p>如果选择了 "No expiration"，Token 不会过期。否则需要定期更新。</p>
          </div>
          <div className="token-guide__faq-item">
            <strong>忘记 Token 怎么办？</strong>
            <p>可以在 GitHub 设置中重新生成一个新的 Token。旧 Token 不会自动失效，如果您不再使用，建议手动删除。</p>
          </div>
          <div className="token-guide__faq-item">
            <strong>多个 Token 冲突吗？</strong>
            <p>不冲突。不同的 Token 都可以访问同一用户的 Gist，您可以创建多个 Token 用于不同设备。</p>
          </div>
          <div className="token-guide__faq-item">
            <strong>如何更安全？</strong>
            <p>建议在 GitHub 账号启用两步验证（2FA），并定期检查授权的 Token 列表。</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
