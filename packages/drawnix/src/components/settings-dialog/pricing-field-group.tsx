import React, { useCallback, useState } from 'react';
import { Select, MessagePlugin } from 'tdesign-react';
import {
  modelPricingService,
  resolveProviderPricingConfig,
} from '../../utils/model-pricing-service';
import { usePricingGroups } from '../../hooks/use-model-pricing';
import type { ProviderProfile } from '../../utils/settings-manager';

interface PricingFieldGroupProps {
  profile: ProviderProfile;
  onUpdateProfile: (updater: (p: ProviderProfile) => ProviderProfile) => void;
}

export const PricingFieldGroup: React.FC<PricingFieldGroupProps> = React.memo(
  ({ profile, onUpdateProfile }) => {
    const [fetching, setFetching] = useState(false);
    const groups = usePricingGroups(profile.id);

    const pricingConfig = resolveProviderPricingConfig(profile);
    const pricingUrl = pricingConfig?.pricingUrl || '';
    const cnyPerUsd = pricingConfig?.cnyPerUsd ?? 1;
    const pricingGroup = pricingConfig?.pricingGroup || 'default';
    const handleFetchPricing = useCallback(async () => {
      if (!pricingConfig) return;
      setFetching(true);
      try {
        await modelPricingService.fetchAndCache(
          profile.id,
          pricingConfig.pricingUrl,
          profile.apiKey,
          pricingConfig.pricingGroup,
          pricingConfig.cnyPerUsd,
          { force: true, promoteToAutoRefresh: true }
        );
        void MessagePlugin.success('价格信息已同步');
      } catch (err) {
        void MessagePlugin.error(
          `获取价格失败: ${err instanceof Error ? err.message : '未知错误'}`
        );
      } finally {
        setFetching(false);
      }
    }, [pricingConfig, profile.id, profile.apiKey]);

    const handleGroupChange = useCallback(
      async (value: string | number) => {
        const nextGroup = String(value);
        onUpdateProfile((p) => ({ ...p, pricingGroup: nextGroup }));
        if (!pricingConfig) return;
        setFetching(true);
        try {
          await modelPricingService.fetchAndCache(
            profile.id,
            pricingConfig.pricingUrl,
            profile.apiKey,
            nextGroup,
            pricingConfig.cnyPerUsd
          );
        } catch {
          // 静默失败，价格数据保持上次缓存
        } finally {
          setFetching(false);
        }
      },
      [onUpdateProfile, pricingConfig, profile.id, profile.apiKey]
    );

    const groupOptions = groups.map((g) => ({
      label: g.displayName || g.name,
      value: g.name,
    }));

    return (
      <div className="settings-dialog__pricing-group">
        <div className="settings-dialog__pricing-row">
          <div className="settings-dialog__field settings-dialog__field--column" style={{ flex: 1, minWidth: 0 }}>
            <label className="settings-dialog__label settings-dialog__label--stacked">
              模型价格 URL
            </label>
            <input
              type="text"
              className="settings-dialog__input"
              value={pricingUrl}
              onChange={(e) =>
                onUpdateProfile((p) => ({ ...p, pricingUrl: e.target.value }))
              }
              placeholder="如 https://api.tu-zi.com/api/pricing"
            />
          </div>
          <div className="settings-dialog__field settings-dialog__field--column" style={{ width: 110, flexShrink: 0 }}>
            <label className="settings-dialog__label settings-dialog__label--stacked">
              ¥/1USD
            </label>
            <input
              type="number"
              className="settings-dialog__input"
              value={cnyPerUsd}
              step={0.01}
              min={0}
              onChange={(e) =>
                onUpdateProfile((p) => ({
                  ...p,
                  cnyPerUsd: parseFloat(e.target.value) || 0,
                }))
              }
            />
          </div>
        </div>
        <div className="settings-dialog__pricing-row">
          {groupOptions.length > 0 ? (
            <div className="settings-dialog__field settings-dialog__field--column" style={{ flex: 1, minWidth: 0 }}>
              <label className="settings-dialog__label settings-dialog__label--stacked">
                当前分组
              </label>
              <Select
                value={pricingGroup}
                options={groupOptions}
                onChange={(v) => handleGroupChange(v as string)}
                style={{ width: '100%' }}
              />
            </div>
          ) : null}
          <button
            type="button"
            className="settings-dialog__button settings-dialog__button--fetch"
            style={{ alignSelf: 'flex-end', height: 32, flexShrink: 0 }}
            onClick={handleFetchPricing}
            disabled={fetching || !pricingUrl}
          >
            {fetching ? '同步中' : '获取价格'}
          </button>
        </div>
      </div>
    );
  }
);
