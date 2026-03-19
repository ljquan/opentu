import React, { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { type ModelVendor } from '../../constants/model-config';
import {
  getDiscoveryVendorLabel,
  getModelVendorPalette,
  ModelVendorMark,
} from './ModelVendorBrand';
import './model-source-icon.scss';

function normalizeIconUrl(iconUrl?: string | null): string | null {
  if (typeof iconUrl !== 'string') {
    return null;
  }

  const trimmed = iconUrl.trim();
  return trimmed || null;
}

function getAvatarLabel(name?: string | null): string {
  const trimmed = name?.trim() || '';
  if (!trimmed) {
    return '供';
  }

  const alphaNumericGroups = trimmed.match(/[A-Za-z0-9]+/g);
  if (alphaNumericGroups?.[0]) {
    return alphaNumericGroups[0][0].toUpperCase();
  }

  return Array.from(trimmed)[0]?.toUpperCase() || '供';
}

export interface ModelSourceIconProps {
  vendor: ModelVendor;
  profileName?: string | null;
  iconUrl?: string | null;
  size?: number;
  className?: string;
}

export const ModelSourceIcon: React.FC<ModelSourceIconProps> = ({
  vendor,
  profileName,
  iconUrl,
  size = 18,
  className,
}) => {
  const normalizedIconUrl = useMemo(() => normalizeIconUrl(iconUrl), [iconUrl]);
  const [imageUrl, setImageUrl] = useState<string | null>(normalizedIconUrl);

  useEffect(() => {
    setImageUrl(normalizedIconUrl);
  }, [normalizedIconUrl]);

  const palette = getModelVendorPalette(vendor);
  const displayName = profileName || getDiscoveryVendorLabel(vendor);
  const shouldUseAvatar = Boolean(profileName || imageUrl);
  const iconStyle = {
    '--model-source-icon-size': `${size}px`,
    '--model-source-icon-accent': palette.accent,
    '--model-source-icon-surface': palette.surface,
    '--model-source-icon-border': palette.border,
  } as CSSProperties;

  return (
    <span
      className={`model-source-icon ${
        shouldUseAvatar
          ? 'model-source-icon--avatar'
          : 'model-source-icon--vendor'
      } ${className || ''}`.trim()}
      style={iconStyle}
      aria-hidden="true"
      title={displayName}
    >
      {shouldUseAvatar ? (
        imageUrl ? (
          <img
            src={imageUrl}
            alt={`${displayName} 图标`}
            className="model-source-icon__image"
            loading="lazy"
            onError={() => setImageUrl(null)}
          />
        ) : (
          <span className="model-source-icon__text">
            {getAvatarLabel(displayName)}
          </span>
        )
      ) : (
        <ModelVendorMark vendor={vendor} size={Math.max(size - 2, 12)} />
      )}
    </span>
  );
};
