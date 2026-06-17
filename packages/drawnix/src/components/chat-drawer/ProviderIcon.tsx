/**
 * ProviderIcon Component
 *
 * SVG icons for different AI model providers.
 */

import React from 'react';
import { ModelProvider } from '../../constants/CHAT_MODELS';

interface ProviderIconProps {
  provider: ModelProvider;
  className?: string;
}

export const ProviderIcon: React.FC<ProviderIconProps> = ({ provider, className = 'w-5 h-5' }) => {
  switch (provider) {
    case ModelProvider.GOOGLE:
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" fill="#4285F4" />
          <text
            x="12"
            y="16"
            fontSize="14"
            fontWeight="700"
            fill="white"
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
          >
            G
          </text>
        </svg>
      );

    case ModelProvider.DEEPSEEK:
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" fill="#6366f1" />
          <path d="M8 12L12 8L16 12L12 16L8 12Z" fill="white" />
        </svg>
      );

    case ModelProvider.OPENAI:
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" fill="#10a37f" />
          <circle cx="12" cy="12" r="4" fill="white" />
        </svg>
      );

    case ModelProvider.ANTHROPIC:
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" fill="#D97757" />
          <path d="M9 12h6M12 9v6" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case ModelProvider.ATLAS:
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" fill="#2563eb" />
          <path
            d="M12 6l4 11h-2.2l-.8-2.4h-2l-.8 2.4H8L12 6zm0 3.6l-.7 2.2h1.4L12 9.6z"
            fill="white"
          />
        </svg>
      );

    default:
      return null;
  }
};
