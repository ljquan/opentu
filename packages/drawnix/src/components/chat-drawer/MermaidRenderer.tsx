/**
 * MermaidRenderer Component
 *
 * Renders Mermaid diagrams in chat messages with preprocessing for compatibility
 */

import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from 'tdesign-react';
import { FullscreenIcon, CloseIcon } from 'tdesign-icons-react';
import { HoverTip } from '../shared';

interface MermaidRendererProps {
  code: string;
  className?: string;
}

/**
 * Preprocess Mermaid code to fix common syntax issues
 */
function preprocessMermaidCode(code: string): string {
  let processed = code;

  // Fix bracket content with special characters
  // Match patterns like [text with : or , or = or other special chars]
  processed = processed.replace(
    /\[([^\]]*[:\,\=\(\)\|\/\\][^\]]*)\]/g,
    (match, content) => {
      // If content is already quoted, skip
      if (content.startsWith('"') && content.endsWith('"')) {
        return match;
      }
      if (content.startsWith("'") && content.endsWith("'")) {
        return match;
      }
      // Wrap with quotes
      return `["${content}"]`;
    }
  );

  // Fix parenthesis content with special characters
  // Match patterns like (text with : or , or = or other special chars)
  processed = processed.replace(
    /\(([^\)]*[:\,\=\[\]\|\/\\][^\)]*)\)/g,
    (match, content) => {
      // If content is already quoted, skip
      if (content.startsWith('"') && content.endsWith('"')) {
        return match;
      }
      if (content.startsWith("'") && content.endsWith("'")) {
        return match;
      }
      // Wrap with quotes
      return `("${content}")`;
    }
  );

  // Fix curly braces content with special characters
  // Match patterns like {text with : or , or = or other special chars}
  processed = processed.replace(
    /\{([^\}]*[:\,\=\[\]\(\)\|\/\\][^\}]*)\}/g,
    (match, content) => {
      // If content is already quoted, skip
      if (content.startsWith('"') && content.endsWith('"')) {
        return match;
      }
      if (content.startsWith("'") && content.endsWith("'")) {
        return match;
      }
      // Wrap with quotes
      return `{"${content}"}`;
    }
  );

  return processed;
}

export const MermaidRenderer: React.FC<MermaidRendererProps> = ({
  code,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [processedCode, setProcessedCode] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [svgContent, setSvgContent] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    const renderMermaid = async () => {
      if (!containerRef.current || !code) return;

      try {
        setIsLoading(true);
        setError(null);

        // Preprocess code to fix common syntax issues
        const processed = preprocessMermaidCode(code);
        setProcessedCode(processed);

        // Dynamically import mermaid
        const mermaid = (await import('mermaid')).default;

        // Initialize mermaid with configuration
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'strict',
          fontFamily: 'Inter, SF Pro Display, -apple-system, sans-serif',
        });

        // Generate unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

        // Render the diagram with preprocessed code
        const { svg } = await mermaid.render(id, processed);

        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setSvgContent(svg);
          setIsLoading(false);
        }
      } catch (err: any) {
        console.error('[MermaidRenderer] Failed to render:', err);
        if (!cancelled) {
          setError(err.message || 'Failed to render diagram');
          setIsLoading(false);
        }
      }
    };

    renderMermaid();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    const hasChanges = processedCode && processedCode !== code;

    return (
      <div className={`mermaid-renderer mermaid-renderer--error ${className}`}>
        <div className="mermaid-renderer__error">
          <strong>Mermaid渲染错误:</strong>
          <pre>{error}</pre>
          <details>
            <summary>查看原始代码</summary>
            <pre>{code}</pre>
          </details>
          {hasChanges && (
            <details>
              <summary>查看预处理后的代码（已自动添加引号）</summary>
              <pre>{processedCode}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  const handleClick = () => {
    if (!isLoading && svgContent) {
      setShowPreview(true);
    }
  };

  return (
    <>
      <div className={`mermaid-renderer ${className}`}>
        {isLoading && (
          <div className="mermaid-renderer__loading">渲染中...</div>
        )}
        <HoverTip content="点击查看大图" showArrow={false}>
          <div
            ref={containerRef}
            className="mermaid-renderer__container"
            style={{ display: isLoading ? 'none' : 'block' }}
            onClick={handleClick}
          />
        </HoverTip>
        {!isLoading && svgContent && (
          <div className="mermaid-renderer__hint">
            <FullscreenIcon size={16} />
            <span>点击查看大图</span>
          </div>
        )}
      </div>

      <Dialog
        visible={showPreview}
        onClose={() => setShowPreview(false)}
        header="Mermaid 图表"
        width="90vw"
        className="mermaid-preview-dialog"
        footer={null}
        closeBtn={<CloseIcon />}
      >
        <div
          className="mermaid-preview-content"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </Dialog>
    </>
  );
};
