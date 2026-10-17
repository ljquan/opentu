import {
  Check,
  ImagePlus,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { useState } from 'react';

type WorkspaceC1SceneProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onAddReference: () => void;
  onSelectionChange: (label: string) => void;
};

export const C1_DEFAULT_PROMPT =
  '暮色中的东方少女，樱花与薄雾环绕，柔和自然光，电影级构图，细腻质感，梦幻而克制';

const promptTags = ['东方美学', '暮色', '唯美'];

export function WorkspaceC1Scene({
  prompt,
  onPromptChange,
  onAddReference,
  onSelectionChange,
}: WorkspaceC1SceneProps) {
  const [activeNode, setActiveNode] = useState('主画板');
  const [activeVariant, setActiveVariant] = useState(1);
  const scenePrompt = prompt || C1_DEFAULT_PROMPT;

  const selectNode = (label: string) => {
    setActiveNode(label);
    onSelectionChange(label);
  };

  const addTag = (tag: string) => {
    const nextPrompt = scenePrompt.includes(tag)
      ? scenePrompt
      : `${scenePrompt}，${tag}`;
    onPromptChange(nextPrompt);
    selectNode('提示词');
  };

  return (
    <section className="next-workspace__c1-scene" aria-label="C1 节点式创作画布">
      <svg
        className="next-workspace__c1-connectors"
        viewBox="0 0 1000 620"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M235 128 H295 Q315 128 315 148 V213 Q315 232 335 232 H405" />
        <path d="M245 372 H292 Q315 372 315 350 V310 Q315 290 335 290 H405" />
        <path d="M590 462 V500" />
        <path d="M745 250 H785 Q805 250 805 228 V176 Q805 156 825 156" />
        <path d="M745 296 H785 Q805 296 805 316 V355 Q805 375 825 375" />
        <path d="M745 330 H770 Q790 330 790 438 Q790 458 825 458" />
      </svg>

      <article
        className={`next-workspace__c1-node next-workspace__c1-reference${
          activeNode === '参考图' ? ' is-selected' : ''
        }`}
        onClick={() => selectNode('参考图')}
      >
        <header><strong>参考图</strong></header>
        <div className="next-workspace__c1-reference-grid">
          <img src="/brand/foxvue-botanical-study.webp" alt="暮色花卉参考" />
          <button type="button" aria-label="添加参考图" onClick={(event) => { event.stopPropagation(); onAddReference(); }}>
            <Plus size={20} />
          </button>
        </div>
      </article>

      <article
        className={`next-workspace__c1-node next-workspace__c1-prompt${
          activeNode === '提示词' ? ' is-selected' : ''
        }`}
        onClick={() => selectNode('提示词')}
      >
        <header>
          <strong>提示词</strong>
          <button type="button" aria-label="聚焦创作描述" onClick={(event) => { event.stopPropagation(); selectNode('提示词'); }}>
            <MoreHorizontal size={16} />
          </button>
        </header>
        <textarea
          aria-label="C1 画布提示词"
          value={scenePrompt}
          onChange={(event) => onPromptChange(event.target.value)}
        />
        <div className="next-workspace__c1-tags">
          {promptTags.map((tag) => (
            <button key={tag} type="button" onClick={(event) => { event.stopPropagation(); addTag(tag); }}>
              {tag}
            </button>
          ))}
          <button type="button" aria-label="添加风格标签" onClick={(event) => { event.stopPropagation(); addTag('高级质感'); }}>
            <Plus size={13} />
          </button>
        </div>
      </article>

      <article
        className={`next-workspace__c1-node next-workspace__c1-main${
          activeNode === '主画板' ? ' is-selected' : ''
        }`}
        onClick={() => selectNode('主画板')}
      >
        <header><strong>主画板</strong><span>1024 x 1024</span></header>
        <div className={`next-workspace__c1-main-image is-variant-${activeVariant}`}>
          <img src="/brand/foxvue-botanical-study.webp" alt="暮色花卉品牌主视觉" />
          <span className="next-workspace__c1-image-title">暮樱</span>
        </div>
      </article>

      <article
        className={`next-workspace__c1-node next-workspace__c1-results${
          activeNode === '生成结果' ? ' is-selected' : ''
        }`}
        onClick={() => selectNode('生成结果')}
      >
        <header><strong>生成结果</strong><span>3 个变体</span></header>
        <div className="next-workspace__c1-variants">
          {[0, 1, 2].map((variant) => (
            <button
              className={activeVariant === variant ? 'is-active' : ''}
              type="button"
              key={variant}
              aria-label={`选择变体 ${variant + 1}`}
              onClick={(event) => {
                event.stopPropagation();
                setActiveVariant(variant);
                selectNode('生成结果');
              }}
            >
              <img
                className={`is-variant-${variant}`}
                src="/brand/foxvue-botanical-study.webp"
                alt=""
              />
              {activeVariant === variant && <span><Check size={13} /></span>}
            </button>
          ))}
        </div>
      </article>

      <article
        className={`next-workspace__c1-node next-workspace__c1-style${
          activeNode === '风格参考' ? ' is-selected' : ''
        }`}
        onClick={() => selectNode('风格参考')}
      >
        <header><strong>风格参考</strong><span>4 张</span></header>
        <div className="next-workspace__c1-style-grid">
          <img src="/brand/foxvue-night-sky.webp" alt="暮色氛围" />
          <img src="/brand/foxvue-botanical-study.webp" alt="花卉质感" />
          <img src="/product_showcase/case-1.png" alt="构图参考" />
          <img src="/product_showcase/case-2.png" alt="色彩参考" />
          <button type="button" aria-label="添加风格参考" onClick={(event) => { event.stopPropagation(); onAddReference(); }}>
            <ImagePlus size={18} />
          </button>
        </div>
      </article>

    </section>
  );
}
