/**
 * 错误日志导出工具
 * 聚合 crash-logger + unified-log-service + 崩溃历史，生成 JSON 文件下载
 */

import type { ErrorInfo } from 'react';
import { getDiagnosticData } from '../crash-logger';
import { crashRecoveryService, unifiedLogService } from '@drawnix/drawnix/runtime';

export interface ErrorLogData {
  exportTime: string;
  version: string;
  environment: {
    userAgent: string;
    url: string;
    timestamp: number;
    language: string;
    platform: string;
    screenSize: string;
  };
  currentError?: {
    message: string;
    stack?: string;
    componentStack?: string;
  };
  crashRecovery: ReturnType<typeof crashRecoveryService.getState>;
  diagnostics: ReturnType<typeof getDiagnosticData>;
  unifiedLogs: ReturnType<typeof unifiedLogService.getMemoryLogs>;
}

/**
 * 收集所有诊断数据并触发 JSON 文件下载
 */
export function collectAndDownloadErrorLog(
  error?: Error | null,
  errorInfo?: ErrorInfo | null
): void {
  try {
    const data = collectErrorLogData(error, errorInfo);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `foxvue-error-log-${timestamp}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // 清理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (e) {
    console.error('[ErrorLogExporter] Failed to export:', e);
  }
}

function collectErrorLogData(
  error?: Error | null,
  errorInfo?: ErrorInfo | null
): ErrorLogData {
  const data: ErrorLogData = {
    exportTime: new Date().toISOString(),
    version: '1.0',
    environment: {
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: Date.now(),
      language: navigator.language,
      platform: navigator.platform,
      screenSize: `${window.screen.width}x${window.screen.height}`,
    },
    crashRecovery: crashRecoveryService.getState(),
    diagnostics: getDiagnosticData(),
    unifiedLogs: unifiedLogService.getMemoryLogs(),
  };

  if (error) {
    data.currentError = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo?.componentStack ?? undefined,
    };
  }

  return data;
}
