interface Id3Frame {
  id: string;
  data: Uint8Array;
}

export interface AudioDownloadMetadata {
  title?: string;
  prompt?: string;
  tags?: string;
  coverUrl?: string;
  artist?: string;
  album?: string;
  year?: string;
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index++) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function utf16LeBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const offset = 2 + index * 2;
    bytes[offset] = code & 0xff;
    bytes[offset + 1] = (code >> 8) & 0xff;
  }
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeSyncSafe(size: number): Uint8Array {
  return new Uint8Array([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
}

function decodeSyncSafe(bytes: Uint8Array): number {
  return (
    ((bytes[0] ?? 0) << 21) |
    ((bytes[1] ?? 0) << 14) |
    ((bytes[2] ?? 0) << 7) |
    (bytes[3] ?? 0)
  );
}

function buildFrame(frame: Id3Frame): Uint8Array {
  const header = new Uint8Array(10);
  header.set(asciiBytes(frame.id.slice(0, 4)), 0);
  const size = frame.data.length;
  header[4] = (size >> 24) & 0xff;
  header[5] = (size >> 16) & 0xff;
  header[6] = (size >> 8) & 0xff;
  header[7] = size & 0xff;
  return concatBytes(header, frame.data);
}

function createTextFrame(id: string, value?: string): Uint8Array | null {
  if (!value?.trim()) {
    return null;
  }
  return buildFrame({
    id,
    data: concatBytes(new Uint8Array([0x01]), utf16LeBytes(value.trim())),
  });
}

function createCommentFrame(value?: string): Uint8Array | null {
  if (!value?.trim()) {
    return null;
  }

  return buildFrame({
    id: 'COMM',
    data: concatBytes(
      new Uint8Array([0x01]),
      asciiBytes('eng'),
      new Uint8Array([0xff, 0xfe, 0x00, 0x00]),
      utf16LeBytes(value.trim())
    ),
  });
}

function stripId3v2Tag(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length < 10 ||
    bytes[0] !== 0x49 ||
    bytes[1] !== 0x44 ||
    bytes[2] !== 0x33
  ) {
    return bytes;
  }

  const tagSize = decodeSyncSafe(bytes.slice(6, 10));
  const footerSize = bytes[5] & 0x10 ? 10 : 0;
  const totalTagSize = 10 + tagSize + footerSize;
  if (totalTagSize >= bytes.length) {
    return bytes;
  }
  return bytes.slice(totalTagSize);
}

async function fetchCoverBytes(coverUrl?: string): Promise<{
  bytes: Uint8Array;
  mimeType: string;
} | null> {
  if (!coverUrl) {
    return null;
  }

  try {
    const response = await fetch(coverUrl, { referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    return {
      bytes: new Uint8Array(buffer),
      mimeType: blob.type || 'image/jpeg',
    };
  } catch {
    return null;
  }
}

async function createApicFrame(coverUrl?: string): Promise<Uint8Array | null> {
  const cover = await fetchCoverBytes(coverUrl);
  if (!cover) {
    return null;
  }

  return buildFrame({
    id: 'APIC',
    data: concatBytes(
      new Uint8Array([0x00]),
      asciiBytes(cover.mimeType),
      new Uint8Array([0x00, 0x03, 0x00]),
      cover.bytes
    ),
  });
}

function isMp3Asset(blob: Blob, sourceUrl: string): boolean {
  return (
    blob.type === 'audio/mpeg' ||
    blob.type === 'audio/mp3' ||
    /\.mp3(?:$|[?#])/i.test(sourceUrl)
  );
}

export async function applyAudioMetadataToBlob(
  blob: Blob,
  metadata: AudioDownloadMetadata | undefined,
  sourceUrl: string
): Promise<Blob> {
  if (!metadata || !isMp3Asset(blob, sourceUrl)) {
    return blob;
  }

  const title = metadata.title?.trim();
  const prompt = metadata.prompt?.trim();
  const tags = metadata.tags?.trim();
  const artist = metadata.artist?.trim() || 'Aitu';
  const album = metadata.album?.trim() || 'Aitu Generated';
  const year = metadata.year?.trim() || String(new Date().getFullYear());

  const frames = (
    await Promise.all([
      Promise.resolve(createTextFrame('TIT2', title)),
      Promise.resolve(createTextFrame('TPE1', artist)),
      Promise.resolve(createTextFrame('TALB', album)),
      Promise.resolve(createTextFrame('TCON', tags)),
      Promise.resolve(createTextFrame('TYER', year)),
      Promise.resolve(createCommentFrame(prompt)),
      createApicFrame(metadata.coverUrl),
    ])
  ).filter((frame): frame is Uint8Array => frame !== null);

  if (frames.length === 0) {
    return blob;
  }

  const sourceBytes = stripId3v2Tag(new Uint8Array(await blob.arrayBuffer()));
  const body = concatBytes(...frames);
  const header = concatBytes(
    asciiBytes('ID3'),
    new Uint8Array([0x03, 0x00, 0x00]),
    encodeSyncSafe(body.length)
  );

  return new Blob([header, body, sourceBytes], {
    type: blob.type || 'audio/mpeg',
  });
}
