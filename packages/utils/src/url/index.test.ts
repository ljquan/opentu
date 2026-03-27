import { describe, it, expect } from 'vitest';
import {
  isDomainMatch,
  isVolcesDomain,
  getFileExtension,
  getHostname,
  isDataURL,
  isAbsoluteURL,
  inferImageMimeTypeFromBase64,
  normalizeImageDataUrl,
} from './index';

describe('isDomainMatch', () => {
  it('should match domain suffixes', () => {
    expect(isDomainMatch('https://cdn.example.com/file.jpg', ['.example.com'])).toBe(true);
    expect(isDomainMatch('https://api.example.com/data', ['.example.com'])).toBe(true);
  });

  it('should match multiple domain suffixes', () => {
    expect(
      isDomainMatch('https://cdn.volces.com/video.mp4', ['.volces.com', '.volccdn.com'])
    ).toBe(true);
    expect(
      isDomainMatch('https://static.volccdn.com/image.png', ['.volces.com', '.volccdn.com'])
    ).toBe(true);
  });

  it('should not match unrelated domains', () => {
    expect(isDomainMatch('https://other.com/file.jpg', ['.example.com'])).toBe(false);
    expect(isDomainMatch('https://notexample.com/file.jpg', ['.example.com'])).toBe(false);
  });

  it('should handle invalid URLs', () => {
    expect(isDomainMatch('not-a-url', ['.example.com'])).toBe(false);
    expect(isDomainMatch('', ['.example.com'])).toBe(false);
  });
});

describe('isVolcesDomain', () => {
  it('should return true for volces.com domains', () => {
    expect(isVolcesDomain('https://cdn.volces.com/video.mp4')).toBe(true);
    expect(isVolcesDomain('https://api.volces.com/data')).toBe(true);
  });

  it('should return true for volccdn.com domains', () => {
    expect(isVolcesDomain('https://static.volccdn.com/image.png')).toBe(true);
    expect(isVolcesDomain('https://media.volccdn.com/file.pdf')).toBe(true);
  });

  it('should return false for other domains', () => {
    expect(isVolcesDomain('https://example.com/file.jpg')).toBe(false);
    expect(isVolcesDomain('https://cloudflare.com/image.png')).toBe(false);
  });

  it('should handle invalid URLs', () => {
    expect(isVolcesDomain('invalid-url')).toBe(false);
  });
});

describe('getFileExtension', () => {
  it('should extract extension from URL path', () => {
    expect(getFileExtension('https://example.com/image.jpg')).toBe('jpg');
    expect(getFileExtension('https://example.com/video.mp4')).toBe('mp4');
    expect(getFileExtension('https://example.com/document.pdf')).toBe('pdf');
  });

  it('should handle nested paths', () => {
    expect(getFileExtension('https://example.com/path/to/file.png')).toBe('png');
    expect(getFileExtension('https://example.com/deep/nested/path/file.webp')).toBe('webp');
  });

  it('should handle query parameters', () => {
    expect(getFileExtension('https://example.com/image.jpg?size=large')).toBe('jpg');
    expect(getFileExtension('https://example.com/file.pdf?download=true')).toBe('pdf');
  });

  it('should extract extension from data URLs', () => {
    expect(getFileExtension('data:image/png;base64,iVBORw...')).toBe('png');
    expect(getFileExtension('data:image/jpeg;base64,/9j/4AAQ...')).toBe('jpg');
    expect(getFileExtension('data:image/webp;base64,UklGR...')).toBe('webp');
  });

  it('should extract extension from raw base64 image payloads', () => {
    expect(getFileExtension('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ')).toBe('png');
    expect(getFileExtension('/9j/4AAQSkZJRgABAQEASABIAAD')).toBe('jpg');
  });

  it('should handle SVG data URLs specially', () => {
    expect(getFileExtension('data:image/svg+xml;base64,PHN2Zy...')).toBe('svg');
    expect(getFileExtension('data:image/svg+xml;charset=utf-8,<svg>...</svg>')).toBe('svg');
  });

  it('should convert jpeg to jpg in data URLs', () => {
    expect(getFileExtension('data:image/jpeg;base64,/9j/4AAQ...')).toBe('jpg');
  });

  it('should use MIME type fallback', () => {
    expect(getFileExtension('https://api.example.com/download/123', 'image/png')).toBe('png');
    expect(getFileExtension('https://api.example.com/download/456', 'video/mp4')).toBe('mp4');
    expect(getFileExtension('https://api.example.com/file', 'image/webp')).toBe('webp');
  });

  it('should return "bin" for unknown types', () => {
    expect(getFileExtension('https://example.com/file')).toBe('bin');
    expect(getFileExtension('https://example.com/file', 'application/octet-stream')).toBe('bin');
  });

  it('should handle mixed case extensions', () => {
    expect(getFileExtension('https://example.com/IMAGE.JPG')).toBe('jpg');
    expect(getFileExtension('https://example.com/Video.MP4')).toBe('mp4');
  });

  it('should reject very long extensions', () => {
    // Extensions longer than 5 characters are considered invalid
    expect(getFileExtension('https://example.com/file.toolongext')).toBe('bin');
  });
});

describe('getHostname', () => {
  it('should extract hostname from URL', () => {
    expect(getHostname('https://www.example.com/path')).toBe('www.example.com');
    expect(getHostname('https://api.example.com/v1/data')).toBe('api.example.com');
  });

  it('should handle URLs without path', () => {
    expect(getHostname('https://example.com')).toBe('example.com');
  });

  it('should return empty string for invalid URLs', () => {
    expect(getHostname('not-a-url')).toBe('');
    expect(getHostname('')).toBe('');
  });

  it('should handle different protocols', () => {
    expect(getHostname('http://example.com')).toBe('example.com');
    expect(getHostname('ftp://example.com')).toBe('example.com');
  });
});

describe('isDataURL', () => {
  it('should return true for data URLs', () => {
    expect(isDataURL('data:image/png;base64,iVBORw...')).toBe(true);
    expect(isDataURL('data:text/plain;charset=utf-8,Hello')).toBe(true);
  });

  it('should return false for regular URLs', () => {
    expect(isDataURL('https://example.com/image.jpg')).toBe(false);
    expect(isDataURL('http://example.com')).toBe(false);
  });

  it('should return false for relative paths', () => {
    expect(isDataURL('/path/to/file')).toBe(false);
    expect(isDataURL('./file.jpg')).toBe(false);
  });
});

describe('isAbsoluteURL', () => {
  it('should return true for absolute URLs with protocol', () => {
    expect(isAbsoluteURL('https://example.com/path')).toBe(true);
    expect(isAbsoluteURL('http://example.com')).toBe(true);
    expect(isAbsoluteURL('ftp://example.com/file')).toBe(true);
  });

  it('should return false for relative paths', () => {
    expect(isAbsoluteURL('/path/to/file')).toBe(false);
    expect(isAbsoluteURL('./file.jpg')).toBe(false);
    expect(isAbsoluteURL('../parent/file.js')).toBe(false);
  });

  it('should return false for protocol-relative URLs', () => {
    expect(isAbsoluteURL('//example.com/path')).toBe(false);
  });

  it('should handle data URLs', () => {
    expect(isAbsoluteURL('data:image/png;base64,iVBORw...')).toBe(true);
  });
});

describe('inferImageMimeTypeFromBase64', () => {
  it('should detect common image signatures', () => {
    expect(inferImageMimeTypeFromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ')).toBe('image/png');
    expect(inferImageMimeTypeFromBase64('/9j/4AAQSkZJRgABAQEASABIAAD')).toBe('image/jpeg');
    expect(inferImageMimeTypeFromBase64('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=')).toBe('image/gif');
  });

  it('should return undefined for unknown payloads', () => {
    expect(inferImageMimeTypeFromBase64('SGVsbG8gV29ybGQ=')).toBeUndefined();
  });
});

describe('normalizeImageDataUrl', () => {
  it('should keep existing URLs unchanged', () => {
    expect(normalizeImageDataUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
    expect(normalizeImageDataUrl('data:image/png;base64,iVBORw...')).toBe('data:image/png;base64,iVBORw...');
  });

  it('should convert raw base64 payloads into data URLs', () => {
    expect(normalizeImageDataUrl('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ')).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    );
  });

  it('should strip whitespace before building the data URL', () => {
    expect(
      normalizeImageDataUrl('  iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ  ')
    ).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ');
  });
});
