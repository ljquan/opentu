import { describe, expect, it } from 'vitest';
import {
  buildLayerDecompositionManifest,
  calculateLayerCanvasBounds,
  calculateLayerCanvasPlacements,
  parseLayerDecompositionRequest,
  parseLayerDecompositionResponse,
  serializeLayerDecompositionManifest,
  sortLayerArtifacts,
  toLayerDecompositionRequestPayload,
  type LayerArtifactPayload,
  type LayerDecompositionResponsePayload,
} from '.';

function payloadLayer(
  zIndex: number,
  overrides: Partial<LayerArtifactPayload> = {}
): LayerArtifactPayload {
  return {
    url: `https://cdn.example.com/layer-${zIndex}.png`,
    z_index: zIndex,
    bounding_box: {
      absolute: zIndex === 0 ? [0, 0, 2000, 1000] : [200, 100, 1000, 500],
      normalized: zIndex === 0 ? [0, 0, 1000, 1000] : [100, 100, 500, 500],
    },
    name: zIndex === 0 ? '背景' : `图层 ${zIndex}`,
    description: '',
    ...overrides,
  };
}

function responsePayload(
  data: LayerArtifactPayload[] = [
    payloadLayer(0),
    payloadLayer(2),
    payloadLayer(1),
  ]
): LayerDecompositionResponsePayload {
  return { group_id: 'group-1', data };
}

describe('layer decomposition contract', () => {
  it('normalizes and serializes a valid request', () => {
    const request = parseLayerDecompositionRequest({
      image: 'https://example.com/source?id=1',
      prompt: '拆分 <bbox>100 200 800 900</bbox> 内的人物',
      max_layers: 8,
    });

    expect(request).toEqual({
      image: 'https://example.com/source?id=1',
      prompt: '拆分 <bbox>100 200 800 900</bbox> 内的人物',
      maxLayers: 8,
    });
    expect(toLayerDecompositionRequestPayload(request)).toEqual({
      image: 'https://example.com/source?id=1',
      prompt: '拆分 <bbox>100 200 800 900</bbox> 内的人物',
      max_layers: 8,
    });
  });

  it('defaults to sixteen layers and accepts image data URLs', () => {
    expect(
      parseLayerDecompositionRequest({
        image: 'data:image/png;base64,cG5n',
      })
    ).toEqual({ image: 'data:image/png;base64,cG5n', maxLayers: 16 });
    expect(
      parseLayerDecompositionRequest({
        image: 'data:image/jpeg;base64,anBlZw==',
      }).image
    ).toContain('data:image/jpeg');
  });

  it.each([
    [{ image: 'javascript:alert(1)' }, 'request.image'],
    [{ image: 'data:text/plain;base64,AAAA' }, 'request.image'],
    [{ image: 'https://example.com/a.png', max_layers: 17 }, 'max_layers'],
    [
      {
        image: 'https://example.com/a.png',
        prompt: '<bbox>0 0 1001 500</bbox>',
      },
      'request.prompt bbox',
    ],
    [
      {
        image: 'https://example.com/a.png',
        prompt: '<bbox>0 0 500</bbox>',
      },
      'request.prompt',
    ],
  ])('rejects malformed requests', (request, expectedPath) => {
    expect(() => parseLayerDecompositionRequest(request)).toThrow(
      expectedPath as string
    );
  });

  it('parses atomically, identifies the background, and sorts foregrounds', () => {
    const response = parseLayerDecompositionResponse({
      ...responsePayload([
        payloadLayer(2, {
          url: 'data:image/png;base64,bGF5ZXI=',
          confidence: 0.9,
        }),
        payloadLayer(0),
        payloadLayer(1),
      ]),
      width: 2000,
      height: 1000,
      quality: { ssim: 0.999, channel_error_rate: 0.001 },
    });

    expect(response.groupId).toBe('group-1');
    expect(response.background.zIndex).toBe(0);
    expect(response.layers.map((layer) => layer.zIndex)).toEqual([1, 2]);
    expect(response.layers[1]).toMatchObject({
      groupId: 'group-1',
      confidence: 0.9,
    });
    expect(response).toMatchObject({
      width: 2000,
      height: 1000,
      quality: { ssim: 0.999, channelErrorRate: 0.001 },
    });
  });

  it('accepts same-origin artifact URLs without allowing protocol-relative URLs', () => {
    const response = parseLayerDecompositionResponse(
      responsePayload([
        payloadLayer(0, { url: '/api/layers/background.png' }),
        payloadLayer(1, { url: '/api/layers/foreground.png' }),
      ])
    );

    expect(response.background.url).toBe('/api/layers/background.png');
    expect(() =>
      parseLayerDecompositionResponse(
        responsePayload([
          payloadLayer(0),
          payloadLayer(1, { url: '//evil.example.com/layer.png' }),
        ])
      )
    ).toThrow('response.data[1].url');
  });

  it('rejects unsafe URLs, invalid bounding boxes, missing backgrounds, and duplicate z-indexes', () => {
    expect(() =>
      parseLayerDecompositionResponse(
        responsePayload([
          payloadLayer(0),
          payloadLayer(1, { url: 'file:///tmp/a' }),
        ])
      )
    ).toThrow('response.data[1].url');
    expect(() =>
      parseLayerDecompositionResponse(
        responsePayload([
          payloadLayer(0),
          payloadLayer(1, {
            bounding_box: {
              absolute: [0, 0, 10, 10],
              normalized: [0, 0, 1001, 10],
            },
          }),
        ])
      )
    ).toThrow('response.data[1].bounding_box.normalized');
    expect(() =>
      parseLayerDecompositionResponse(responsePayload([payloadLayer(1)]))
    ).toThrow('exactly one z_index=0 background');
    expect(() =>
      parseLayerDecompositionResponse(
        responsePayload([payloadLayer(0), payloadLayer(1), payloadLayer(1)])
      )
    ).toThrow('duplicate z_index=1');
    expect(() =>
      parseLayerDecompositionResponse(
        responsePayload([
          payloadLayer(0, {
            bounding_box: {
              absolute: [0, 0, 1000, 500],
              normalized: [0, 0, 500, 500],
            },
          }),
        ])
      )
    ).toThrow('must cover [0, 0, 1000, 1000]');
  });

  it('rejects more than sixteen foreground layers', () => {
    expect(() =>
      parseLayerDecompositionResponse(
        responsePayload([
          payloadLayer(0),
          ...Array.from({ length: 17 }, (_, index) => payloadLayer(index + 1)),
        ])
      )
    ).toThrow('more than 16 foreground layers');
  });

  it('sorts without mutating the caller array', () => {
    const input = [{ zIndex: 3 }, { zIndex: 1 }, { zIndex: 2 }];
    expect(sortLayerArtifacts(input).map((item) => item.zIndex)).toEqual([
      1, 2, 3,
    ]);
    expect(input.map((item) => item.zIndex)).toEqual([3, 1, 2]);
  });
});

describe('layer decomposition geometry and manifest', () => {
  it('maps pixel bounding boxes into source canvas bounds', () => {
    const response = parseLayerDecompositionResponse(responsePayload());
    const sourceBounds = { x: 100, y: 50, width: 500, height: 250 };
    const pixelSize = { width: 2000, height: 1000 };

    expect(
      calculateLayerCanvasBounds(response.background, sourceBounds, pixelSize)
    ).toEqual(sourceBounds);
    expect(
      calculateLayerCanvasBounds(response.layers[0], sourceBounds, pixelSize)
    ).toEqual({ x: 150, y: 75, width: 200, height: 100 });
    expect(
      calculateLayerCanvasPlacements(
        [response.layers[1], response.background, response.layers[0]],
        sourceBounds,
        pixelSize
      ).map((placement) => placement.artifact.zIndex)
    ).toEqual([0, 1, 2]);
  });

  it('rejects geometry that exceeds the background pixels', () => {
    const response = parseLayerDecompositionResponse(responsePayload());
    expect(() =>
      calculateLayerCanvasBounds(
        response.layers[0],
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 500, height: 500 }
      )
    ).toThrow('exceeds background pixel bounds');
  });

  it('exports a deterministic, sorted, detached JSON manifest', () => {
    const response = parseLayerDecompositionResponse(responsePayload());
    const manifest = buildLayerDecompositionManifest(response);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.layers.map((layer) => [layer.kind, layer.zIndex])).toEqual([
      ['background', 0],
      ['foreground', 1],
      ['foreground', 2],
    ]);
    manifest.layers[1].boundingBox.absolute[0] = 999;
    expect(response.layers[0].boundingBox.absolute[0]).toBe(200);
    expect(JSON.parse(serializeLayerDecompositionManifest(response))).toEqual(
      buildLayerDecompositionManifest(response)
    );
  });
});
