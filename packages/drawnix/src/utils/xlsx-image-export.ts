import JSZip from 'jszip';

export interface XlsxEmbeddedImage {
  row: number;
  column: number;
  bytes: Uint8Array;
  contentType: string;
  name: string;
  offset?: number;
  width?: number;
  height?: number;
}

function contentTypeFor(url: string, blobType = ''): string {
  if (blobType.startsWith('image/')) return blobType;
  if (blobType && blobType !== 'application/octet-stream') {
    throw new Error('图片来源返回了非图片内容');
  }
  const extension = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return extension === 'jpg' || extension === 'jpeg'
    ? 'image/jpeg'
    : extension === 'gif'
    ? 'image/gif'
    : extension === 'webp'
    ? 'image/webp'
    : 'image/png';
}

function dataUrlBytes(
  value: string
): { bytes: Uint8Array; contentType: string } | null {
  const match = value.match(/^data:(image\/[\w.+-]+);base64,([\w+/=]+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType: match[1] };
}

export async function readImageBytes(
  url: string,
  cachedBlob?: Blob | null
): Promise<{
  bytes: Uint8Array;
  contentType: string;
  width?: number;
  height?: number;
}> {
  const data = dataUrlBytes(url);
  const readDimensions = async (bytes: Uint8Array, contentType: string) => {
    if (typeof createImageBitmap !== 'function') return { width: 1, height: 1 };
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: contentType })
    );
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  };
  if (data)
    return { ...data, ...(await readDimensions(data.bytes, data.contentType)) };
  if (cachedBlob) {
    const bytes = new Uint8Array(await cachedBlob.arrayBuffer());
    const contentType = contentTypeFor(url, cachedBlob.type);
    return {
      bytes,
      contentType,
      ...(await readDimensions(bytes, contentType)),
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`图片请求失败：${response.status}`);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const contentType = contentTypeFor(url, blob.type);
    return {
      bytes,
      contentType,
      ...(await readDimensions(bytes, contentType)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function mapExportImages<T, R>(
  items: T[],
  process: (item: T, index: number) => Promise<R>,
  concurrency = 8
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await process(items[index], index);
      }
    })
  );
  return results;
}

export function splitExcelSource(source: string): string[] {
  const parts: string[] = [];
  for (let offset = 0; offset < source.length; offset += 32000) {
    parts.push(source.slice(offset, offset + 32000));
  }
  return parts.length ? parts : [''];
}

function xmlEscape(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (char) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[
        char
      ] || char)
  );
}

/** Adds standard SpreadsheetML drawing parts to an already generated XLSX. */
export async function embedImagesInXlsx(
  buffer: ArrayBuffer,
  images: XlsxEmbeddedImage[]
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const sheet = zip.file(sheetPath);
  if (!sheet) throw new Error('导出工作表缺失');
  const stylesFile = zip.file('xl/styles.xml');
  if (stylesFile) {
    let styles = await stylesFile.async('text');
    const cellXfs = styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
    if (cellXfs) {
      const currentCount = Number(
        cellXfs[1].match(/\bcount="(\d+)"/)?.[1] || 0
      );
      const wrapStyle = `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf>`;
      styles = styles.replace(
        cellXfs[0],
        cellXfs[0]
          .replace(/<\/cellXfs>/, `${wrapStyle}</cellXfs>`)
          .replace(/\bcount="\d+"/, `count="${currentCount + 1}"`)
      );
      zip.file('xl/styles.xml', styles);
      const sheetXml = await sheet.async('text');
      zip.file(
        sheetPath,
        sheetXml.replace(/<c\b([^>]*)>/g, (_tag, attributes: string) => {
          if (/\bs="\d+"/.test(attributes))
            return `<c${attributes.replace(
              /\bs="\d+"/,
              `s="${currentCount}"`
            )}>`;
          return `<c${attributes} s="${currentCount}">`;
        })
      );
    }
  }
  if (!images.length)
    return (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer;
  const drawingPath = 'xl/drawings/drawing1.xml';
  const drawingRelsPath = 'xl/drawings/_rels/drawing1.xml.rels';
  const sheetRelsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  const sheetRels = zip.file(sheetRelsPath);
  const rels = sheetRels
    ? await sheetRels.async('text')
    : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const relId = 'rIdBatchDrawing';
  zip.file(
    sheetRelsPath,
    rels.replace(
      '</Relationships>',
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`
    )
  );
  const sheetXml = await zip.file(sheetPath)?.async('text');
  if (!sheetXml) throw new Error('导出工作表缺失');
  zip.file(
    sheetPath,
    sheetXml.includes('<drawing ')
      ? sheetXml
      : sheetXml.replace(
          '</worksheet>',
          `<drawing r:id="${relId}"/></worksheet>`
        )
  );

  const drawingRels: string[] = [];
  const anchors: string[] = [];
  images.forEach((image, index) => {
    const extension = image.contentType.split('/')[1].replace('jpeg', 'jpg');
    const mediaPath = `xl/media/batch-image-${index + 1}.${extension}`;
    const imageRelId = `rIdImage${index + 1}`;
    zip.file(mediaPath, image.bytes);
    drawingRels.push(
      `<Relationship Id="${imageRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/batch-image-${
        index + 1
      }.${extension}"/>`
    );
    const name = xmlEscape(image.name || `image-${index + 1}`);
    const rows = Math.ceil(
      images
        .filter(
          (item) => item.row === image.row && item.column === image.column
        )
        .reduce((max, item) => Math.max(max, (item.offset || 0) + 1), 0) / 13
    );
    const slotHeight = Math.min(130, 520 / Math.max(1, rows));
    const extent = Math.round(Math.min(120, slotHeight - 2) * 9525);
    const width = Math.max(1, image.width || 1);
    const height = Math.max(1, image.height || 1);
    const aspectScale = Math.min(1, width >= height ? 1 : width / height);
    const cx = Math.max(
      1,
      Math.round(extent * (width >= height ? 1 : aspectScale))
    );
    const cy = Math.max(
      1,
      Math.round(extent * (height >= width ? 1 : height / width))
    );
    anchors.push(
      `<xdr:oneCellAnchor><xdr:from><xdr:col>${
        image.column
      }</xdr:col><xdr:colOff>${
        ((image.offset || 0) % 13) * 130 * 9525
      }</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>${Math.round(
        (20 + Math.floor((image.offset || 0) / 13) * slotHeight) * 9525
      )}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${
        index + 1
      }" name="${name}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${imageRelId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
    );
  });
  zip.file(
    drawingPath,
    `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join(
      ''
    )}</xdr:wsDr>`
  );
  zip.file(
    drawingRelsPath,
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join(
      ''
    )}</Relationships>`
  );
  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    let contentTypes = await contentTypesFile.async('text');
    if (!contentTypes.includes('/xl/drawings/drawing1.xml'))
      contentTypes = contentTypes.replace(
        '</Types>',
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'
      );
    for (const type of new Set(images.map((image) => image.contentType))) {
      const extension = type.split('/')[1].replace('jpeg', 'jpg');
      if (!contentTypes.includes(`Extension="${extension}"`))
        contentTypes = contentTypes.replace(
          '</Types>',
          `<Default Extension="${extension}" ContentType="${type}"/></Types>`
        );
    }
    zip.file('[Content_Types].xml', contentTypes);
  }
  return (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer;
}
