import {
  ArrowUpRight,
  AudioLines,
  Bot,
  Image,
  LoaderCircle,
  Search,
  Settings2,
  Sparkles,
  Telescope,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  loadMarketplaceCatalog,
  marketplaceCategoryLabels,
  type MarketplaceCatalogSource,
  type MarketplaceCategory,
  type MarketplaceModel,
} from './model-marketplace-catalog';
import { X, CheckCircle2 } from 'lucide-react';

type ModelMarketplaceProps = {
  onOpenMusicStation?: (modelId?: string) => void;
  onOpenModel?: (model: MarketplaceModel) => void;
  onStartCreating: () => Promise<void>;
  isOpen?: boolean;
  onClose?: () => void;
  onOpenAdmin?: () => void;
  canManageProviders?: boolean;
};

const categories: MarketplaceCategory[] = [
  'featured',
  'image',
  'video',
  'audio',
  'text',
  'research',
];

const INITIAL_MODEL_COUNT = 8;

function CategoryIcon({ category }: { category: MarketplaceModel['category'] }) {
  if (category === 'image') return <Image size={18} />;
  if (category === 'video') return <Video size={18} />;
  if (category === 'audio') return <AudioLines size={18} />;
  if (category === 'research') return <Telescope size={18} />;
  return <Bot size={18} />;
}

export function ModelMarketplace({
  onOpenMusicStation,
  onOpenModel,
  onStartCreating,
  isOpen = false,
  onClose,
  onOpenAdmin,
  canManageProviders = false,
}: ModelMarketplaceProps) {
  const [catalog, setCatalog] = useState<MarketplaceModel[]>([]);
  const [source, setSource] = useState<MarketplaceCatalogSource>('curated');
  const [activeCategory, setActiveCategory] =
    useState<MarketplaceCategory>('featured');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(INITIAL_MODEL_COUNT);
  const [loading, setLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState<MarketplaceModel | null>(null);

  useEffect(() => {
    let active = true;
    void loadMarketplaceCatalog().then((result) => {
      if (!active) return;
      setCatalog(result.models);
      setSource(result.source);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setVisibleCount(INITIAL_MODEL_COUNT);
  }, [activeCategory, query]);

  const categoryCounts = useMemo(
    () =>
      categories.reduce<Record<MarketplaceCategory, number>>(
        (counts, category) => {
          counts[category] =
            category === 'featured'
              ? catalog.filter((model) => model.featured).length
              : catalog.filter((model) => model.category === category).length;
          return counts;
        },
        { featured: 0, image: 0, video: 0, audio: 0, text: 0, research: 0 }
      ),
    [catalog]
  );

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return catalog.filter((model) => {
      const categoryMatches =
        activeCategory === 'featured'
          ? model.featured
          : model.category === activeCategory;
      if (!categoryMatches) return false;
      if (!normalizedQuery) return true;
      return [
        model.name,
        model.vendor,
        model.id,
        model.description,
        ...model.tags,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [activeCategory, catalog, query]);

  const visibleModels = filteredModels.slice(0, visibleCount);

  const openModel = (model: MarketplaceModel) => {
    if (model.category === 'audio') {
      onOpenMusicStation?.(model.id);
      return;
    }
    if (onOpenModel) {
      onOpenModel(model);
      return;
    }
    void onStartCreating();
  };

  const detailModel = selectedModel || visibleModels[0] || catalog[0];

  return (
    <section
      className="home-section home-section--models"
      id="models"
      aria-labelledby="models-title"
    >
      <div className="home-marketplace__heading">
        <div>
          <span className="home-marketplace__eyebrow">
            <Sparkles size={14} /> MODEL MARKETPLACE
          </span>
          <h2 id="models-title">模型广场</h2>
          <p>{source === 'managed' ? '平台已完成接入与维护，选择模型即可开始创作。' : '浏览平台精选模型，进入创作后使用当前模型配置。'}</p>
        </div>
        <div className="home-marketplace__header-actions">
          {canManageProviders && onOpenAdmin ? (
            <button className="home-marketplace__manage" type="button" onClick={onOpenAdmin}>
              <Settings2 size={15} /> 管理模型
            </button>
          ) : null}
          <div className="home-marketplace__summary">
            <strong>{catalog.length || '—'}</strong>
            <span>{source === 'managed' ? '管理员已上架' : '平台精选模型'}</span>
          </div>
        </div>
      </div>

      <div className="home-marketplace__toolbar">
        <div className="home-marketplace__tabs" role="tablist" aria-label="模型分类">
          {categories.map((category) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === category}
              className={activeCategory === category ? 'is-active' : ''}
              key={category}
              onClick={() => setActiveCategory(category)}
            >
              {marketplaceCategoryLabels[category]}
              <span>{categoryCounts[category]}</span>
            </button>
          ))}
        </div>
        <label className="home-marketplace__search">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模型、厂商或能力"
            aria-label="搜索模型"
          />
        </label>
      </div>

      {loading ? (
        <div className="home-marketplace__state" role="status">
          <LoaderCircle className="is-spinning" size={20} /> 正在读取模型目录
        </div>
      ) : visibleModels.length ? (
        <>
          <div className="home-marketplace__grid">
            {visibleModels.map((model, index) => (
              <article
                className={`home-marketplace-card home-marketplace-card--${model.accent}${
                  activeCategory === 'featured' && index < 2 ? ' is-leading' : ''
                }`}
                key={model.id}
              >
                <div className="home-marketplace-card__topline">
                  <span className="home-marketplace-card__icon">
                    <CategoryIcon category={model.category} />
                  </span>
                  <span className="home-marketplace-card__vendor">
                    {model.vendor}
                  </span>
                  {model.featured ? (
                    <span className="home-marketplace-card__recommended">推荐</span>
                  ) : null}
                </div>
                <div className="home-marketplace-card__body">
                  <h3>{model.name}</h3>
                  <code>{model.id}</code>
                  <p>{model.description}</p>
                </div>
                <div className="home-marketplace-card__tags">
                  {model.tags.slice(0, 3).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <button type="button" onClick={() => openModel(model)}>
                  {model.category === 'audio' ? '进入音乐台' : source === 'managed' ? '立即创作' : '进入创作'}
                  <ArrowUpRight size={15} />
                </button>
              </article>
            ))}
          </div>
          {visibleCount < filteredModels.length ? (
            <button
              className="home-marketplace__more"
              type="button"
              onClick={() => setVisibleCount((count) => count + 8)}
            >
              查看更多模型
              <span>
                {Math.min(filteredModels.length - visibleCount, 8)} 个
              </span>
            </button>
          ) : null}
        </>
      ) : (
        <div className="home-marketplace__state">
          <Search size={20} />
          <strong>{catalog.length ? '没有找到匹配的模型' : '还没有可用模型'}</strong>
          <span>{catalog.length ? '换一个关键词，或切换模型分类。' : canManageProviders ? '完成供应商接入、模型上架和网关开启后，模型会显示在这里。' : '平台管理员正在配置模型服务。'}</span>
          {!catalog.length && canManageProviders && onOpenAdmin ? (
            <button className="home-marketplace__manage" type="button" onClick={onOpenAdmin}>
              <Settings2 size={15} /> 去配置模型
            </button>
          ) : null}
        </div>
      )}

      {isOpen ? (
        <div className="model-marketplace-overlay" role="dialog" aria-modal="true" aria-labelledby="model-marketplace-dialog-title">
          <div className="model-marketplace-overlay__backdrop" onClick={onClose} />
          <div className="model-marketplace-dialog">
            <header className="model-marketplace-dialog__header">
              <div>
                <span className="home-marketplace__eyebrow">MODEL LIBRARY</span>
                <h2 id="model-marketplace-dialog-title">模型广场</h2>
                <p>{source === 'managed' ? '按创作目的选择平台已经维护好的模型，选定后直接开始。' : '按创作目的浏览精选模型，使用前请确认当前模型配置。'}</p>
              </div>
              <div className="model-marketplace-dialog__actions">
                {canManageProviders && onOpenAdmin ? <button type="button" className="model-marketplace-dialog__manage" onClick={() => { onClose?.(); onOpenAdmin(); }}><Settings2 size={15} /> 管理模型</button> : null}
                <button type="button" className="model-marketplace-dialog__close" aria-label="关闭模型广场" onClick={onClose}>
                  <X size={20} />
                </button>
              </div>
            </header>
            <div className="model-marketplace-dialog__body">
              <aside className="model-marketplace-dialog__categories" aria-label="模型分类">
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={activeCategory === category ? 'is-active' : ''}
                    onClick={() => setActiveCategory(category)}
                  >
                    <span>{marketplaceCategoryLabels[category]}</span>
                    <small>{categoryCounts[category]}</small>
                  </button>
                ))}
              </aside>
              <div className="model-marketplace-dialog__list">
                <label className="home-marketplace__search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索模型、厂商或能力"
                    aria-label="搜索模型"
                  />
                </label>
                <div className="model-marketplace-dialog__cards">
                  {filteredModels.map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      className={`model-marketplace-dialog-card${detailModel?.id === model.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedModel(model)}
                    >
                      <span className={`model-marketplace-dialog-card__icon home-marketplace-card--${model.accent}`}>
                        <CategoryIcon category={model.category} />
                      </span>
                      <span className="model-marketplace-dialog-card__copy">
                        <strong>{model.name}</strong>
                        <small>{model.vendor} · {marketplaceCategoryLabels[model.category]}</small>
                      </span>
                      {model.featured ? <span className="model-marketplace-dialog-card__tag">精选</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              <aside className="model-marketplace-dialog__detail">
                {detailModel ? (
                  <>
                    <span className={`model-marketplace-detail__icon model-marketplace-detail__icon--${detailModel.accent}`}>
                      <CategoryIcon category={detailModel.category} />
                    </span>
                    <span className="model-marketplace-detail__category">{marketplaceCategoryLabels[detailModel.category]}</span>
                    <h3>{detailModel.name}</h3>
                    <p>{detailModel.description}</p>
                    <div className="model-marketplace-detail__tags">
                      {detailModel.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                    <div className="model-marketplace-detail__note"><CheckCircle2 size={15} /> {source === 'managed' ? '管理员已配置，可直接使用' : '精选目录，使用当前模型配置'}</div>
                    <button type="button" className="model-marketplace-detail__action" onClick={() => { onClose?.(); openModel(detailModel); }}>
                      {detailModel.category === 'audio' ? '进入音乐台' : '使用此模型'}
                      <ArrowUpRight size={16} />
                    </button>
                  </>
                ) : <div className="home-marketplace__state">暂无可用模型</div>}
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
