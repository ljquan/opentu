// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParametersDropdown } from './ParametersDropdown';
import { getEffectiveVideoCompatibleParams } from '../../services/video-binding-utils';
import { getSunoV2Params } from '../../services/suno-v2-params';
import { GPT_IMAGE_26_MODEL_IDS } from '../../constants/model-config';

vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
afterEach(cleanup);

describe('GPT Image 2.6 output controls', () => {
  it.each(GPT_IMAGE_26_MODEL_IDS.filter((id) => id !== 'gpt-image-2.6-1k'))('separates %s aspect ratios and resolution, preserving both selections across output modes', (modelId) => {
    const onParamChange = vi.fn();
    const props = { isOpen: true, modelId, onParamChange };
    const { rerender } = render(<ParametersDropdown {...props} selectedParams={{}} />);
    expect(screen.getByText('图片比例')).toBeTruthy();
    const resolution = within(screen.getByText('图片分辨率').closest('.parameters-dropdown__section') as HTMLElement);
    expect(resolution.getAllByRole('button').map((button) => button.textContent?.replace('✓', '').trim()))
      .toEqual(['自动', '1K', '2K', '4K']);
    for (const [label, size] of [['16:9 横版', '16x9'], ['3:4 竖版', '3x4'], ['21:9 超宽', '21x9']]) {
      fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
      expect(onParamChange).toHaveBeenCalledWith('size', size);
    }
    fireEvent.click(resolution.getByRole('button', { name: '2K', exact: true }));
    expect(onParamChange).toHaveBeenCalledWith('resolution', '2k');
    rerender(<ParametersDropdown {...props} selectedParams={{ size: '16x9', resolution: '2k' }} />);
    expect(screen.getByRole('button', { name: '16:9 横版', exact: true, pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2K', exact: true, pressed: true })).toBeTruthy();
    for (const output of ['gif', 'gif_official', 'svg']) {
      rerender(<ParametersDropdown {...props} selectedParams={{ size: '4096x4096', gpt_image_26_output: output }} />);
      expect(screen.queryByText('图片分辨率')).toBeNull();
    }
    rerender(<ParametersDropdown {...props} selectedParams={{ size: '4096x4096', gpt_image_26_output: 'auto' }} />);
    expect(screen.getByRole('button', { name: '1:1 方形', exact: true, pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: '4K', exact: true, pressed: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^2K 方形/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^4K 方形/ })).toBeNull();
  });

  it.each(['gpt-image-2.6', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])('exposes a single parameter GIF and SVG for %s', (modelId) => {
    const onParamChange = vi.fn();
    render(<ParametersDropdown isOpen modelId={modelId}
      selectedParams={{ gpt_image_26_output: 'auto' }} onParamChange={onParamChange} />);
    expect(screen.getByText(/GIF 使用参数请求，default 分组也可使用/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^GIF/ })).toHaveLength(1);
    for (const [name, value] of [['GIF', 'gif_official'], ['SVG', 'svg']]) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(onParamChange).toHaveBeenCalledWith('gpt_image_26_output', value);
    }
    expect(screen.getByRole('switch', { name: '高级功能' })).toBeTruthy();
  });

  it.each(['gpt-image-2.6', 'gpt-image-2.6-flare'])('shows only the selected format advanced options for %s', (modelId) => {
    const props = { isOpen: true, modelId, onParamChange: vi.fn() };
    const { rerender } = render(<ParametersDropdown {...props} selectedParams={{ gpt_image_26_output: 'gif_official' }} />);
    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    expect(screen.getByRole('spinbutton', { name: 'GIF 帧数' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '透明' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '高清' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'SVG 编写模型' })).toBeNull();
    rerender(<ParametersDropdown {...props} selectedParams={{ gpt_image_26_output: 'svg' }} />);
    expect(screen.queryByRole('spinbutton', { name: 'GIF 帧数' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'SVG 编写模型' })).toBeTruthy();
  });

  it.each(GPT_IMAGE_26_MODEL_IDS)(
    'offers static parameters for %s and hides incompatible fields in other output modes', (modelId) => {
      const onParamChange = vi.fn();
      const props = { isOpen: true, modelId, onParamChange };
      const { rerender } = render(<ParametersDropdown {...props} selectedParams={{ gpt_image_26_output: 'auto', output_format: 'png' }} />);
      fireEvent.click(screen.getByRole('button', { name: '透明' }));
      expect(onParamChange).toHaveBeenCalledWith('background', 'transparent');
      fireEvent.click(screen.getByRole('button', { name: '高清' }));
      expect(onParamChange).toHaveBeenCalledWith('quality', 'high');
      fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
      expect(screen.getByRole('button', { name: 'PNG', exact: true })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'WebP' }));
      expect(onParamChange).toHaveBeenCalledWith('output_format', 'webp');
      expect(screen.queryByRole('spinbutton', { name: '压缩质量' })).toBeNull();
      expect(screen.getByText('参考图保真度')).toBeTruthy();
      rerender(<ParametersDropdown {...props} selectedParams={{ gpt_image_26_output: 'auto', output_format: 'webp' }} />);
      fireEvent.change(screen.getByRole('spinbutton', { name: '压缩质量' }), { target: { value: '0' } });
      expect(onParamChange).toHaveBeenCalledWith('output_compression', '0', { keepOpen: true });
      rerender(<ParametersDropdown {...props} selectedParams={{ gpt_image_26_output: 'gif', output_format: 'webp' }} />);
      expect(screen.getByRole('button', { name: '透明' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '高清' })).toBeTruthy();
      expect(screen.queryByText('输出格式')).toBeNull();
      expect(screen.queryByText('参考图保真度')).toBeNull();
      expect(screen.queryByRole('spinbutton', { name: '压缩质量' })).toBeNull();
      expect(Boolean(screen.queryByRole('spinbutton', { name: 'GIF 帧数' }))).toBe(modelId !== 'gpt-image-2.6-1k');
    }
  );

  it.each(GPT_IMAGE_26_MODEL_IDS.filter((id) => id !== 'gpt-image-2.6-1k'))(
    'lets %s select transparency and quality in parameter GIF with advanced options collapsed', (modelId) => {
      const onParamChange = vi.fn();
      const props = { isOpen: true, modelId, onParamChange };
      const { rerender } = render(<ParametersDropdown {...props} selectedParams={{ gpt_image_26_output: 'gif_official' }} />);
      fireEvent.click(screen.getByRole('button', { name: '透明' }));
      expect(onParamChange).toHaveBeenCalledWith('background', 'transparent');
      fireEvent.click(screen.getByRole('button', { name: '高清' }));
      expect(onParamChange).toHaveBeenCalledWith('quality', 'high');
      expect(screen.queryByText('输出格式')).toBeNull();
      fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
      expect(screen.getByRole('spinbutton', { name: 'GIF 帧数' })).toBeTruthy();
      rerender(<ParametersDropdown {...props} selectedParams={{ gpt_image_26_output: 'svg' }} />);
      expect(screen.queryByText('图片背景')).toBeNull();
      expect(screen.queryByRole('button', { name: '高清' })).toBeNull();
      expect(screen.getByRole('textbox', { name: 'SVG 编写模型' })).toBeTruthy();
    }
  );

  it('limits the existing 1k model to its established prompt GIF mode', () => {
    render(<ParametersDropdown isOpen modelId="gpt-image-2.6-1k" selectedParams={{}} onParamChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'GIF', exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'SVG', exact: true })).toBeNull();
    expect(screen.queryByText('图片分辨率')).toBeNull();
    expect(screen.queryByRole('button', { name: '3:4 竖版', exact: true })).toBeNull();
  });

  it.each(['gif', 'gif_official'])('shows saved %s as the single selected GIF option', (output) => {
    render(<ParametersDropdown isOpen modelId="gpt-image-2.6"
      selectedParams={{ gpt_image_26_output: output }} onParamChange={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^GIF/, pressed: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'GIF', exact: true, pressed: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'GIF（提示词）' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'GIF（参数）' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    expect(screen.getByRole('spinbutton', { name: 'GIF 帧数' })).toBeTruthy();
  });

  it('keeps the parameter menu open after choosing a custom SVG writer', async () => {
    const onParamChange = vi.fn();
    const onOpenChange = vi.fn();
    render(<ParametersDropdown isOpen modelId="gpt-image-2.6-sunburst"
      selectedParams={{ gpt_image_26_output: 'svg', svg_model: 'gpt-5.5' }}
      onParamChange={onParamChange} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    const input = screen.getByRole('textbox', { name: 'SVG 编写模型' });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'custom-svg-writer' } });
    const option = await screen.findByText(/custom-svg-writer/);
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(onParamChange).toHaveBeenCalledWith('svg_model', 'custom-svg-writer', { keepOpen: true });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('Suno v2 parameter controls', () => {
  it('accepts multiple reference URL lines for training instead of an empty multiselect', () => {
    const onParamChange = vi.fn();
    render(<ParametersDropdown isOpen modelId="suno/create-model" selectedParams={{}} onParamChange={onParamChange} />);
    const urls = 'https://cdn.test/one.mp3\nhttps://cdn.test/two.mp3';
    fireEvent.change(screen.getByRole('textbox', { name: '音频地址列表' }), { target: { value: urls } });
    expect(onParamChange).toHaveBeenCalledWith('audio_urls', urls, { keepOpen: true });
    expect(screen.queryByRole('listbox', { name: '音频地址列表' })).toBeNull();
  });
  it.each(['suno/create-voice', 'suno/add-instrumental', 'suno/add-vocals'])('does not expose callable parameters for %s', (modelId) => {
    render(<ParametersDropdown isOpen modelId={modelId} selectedParams={{}} onParamChange={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: '音频地址' })).toBeNull();
    expect(screen.queryByText('源曲目')).toBeNull();
    expect(screen.queryByText('模型版本')).toBeNull();
  });
  it('selects public resources and multiple export formats', () => {
    const onParamChange = vi.fn();
    render(<ParametersDropdown isOpen modelId="suno/download" selectedParams={{ music_id: 'm', formats: '["mp3"]' }}
      compatibleParams={getSunoV2Params('suno/download', [{ id: 'm', kind: 'music_id', profileId: 'p' }])} onParamChange={onParamChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: '源曲目' }), { target: { value: 'm' } });
    expect(onParamChange).toHaveBeenCalledWith('music_id', 'm', { keepOpen: true });
    const formats = screen.getByRole('listbox', { name: '导出格式' }) as HTMLSelectElement;
    formats.options[2].selected = true;
    fireEvent.change(formats);
    expect(onParamChange).toHaveBeenCalledWith('formats', '["mp3","wav"]', { keepOpen: true });
    expect(screen.queryByText('动作类型')).toBeNull();
  });
});

describe('Seedream API parameters', () => {
  it.each(['doubao-seedream-5-0-lite-260128', 'seedream-5.0'])(
    'offers size and 2K/3K controls for %s', (modelId) => {
    const onParamChange = vi.fn();
    render(
      <ParametersDropdown
        isOpen
        modelId={modelId}
        selectedParams={{ size: '1x1', seedream_quality: '2k' }}
        onParamChange={onParamChange}
      />
    );
    expect(screen.getByText('图片尺寸')).toBeTruthy();
    expect(screen.getByText('图片质量')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '3K' }));
    expect(onParamChange).toHaveBeenCalledWith('seedream_quality', '3k');
    fireEvent.click(screen.getByRole('button', { name: '16:9 横版' }));
    expect(onParamChange).toHaveBeenCalledWith('size', '16x9');
    expect(screen.queryByText('图片水印')).toBeNull();
    expect(screen.queryByText('输出格式')).toBeNull();
    expect(screen.queryByRole('switch', { name: '高级功能' })).toBeNull();
  });
});

describe('GPT Image advanced parameters', () => {
  it('shows Veo advanced controls without a channel declaration', () => {
    const onParamChange = vi.fn();
    render(<ParametersDropdown isOpen modelId="veo3.1" selectedParams={{}}
      compatibleParams={getEffectiveVideoCompatibleParams('veo3.1', 'veo3.1', null)}
      onParamChange={onParamChange} />);
    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    for (const label of ['负向提示词', '生成音频', '随机种子', '人物生成']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'allow_adult' }));
    expect(onParamChange).toHaveBeenCalledWith('person_generation', 'allow_adult');
  });
  it.each([
    'gpt-image-2.5-1k',
    'gpt-image-2.5',
    'gpt-image-2.5-vip',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.5-flare',
  ])(
    'keeps basic controls visible and reveals advanced controls for %s only after toggling',
    (modelId) => {
      const onParamChange = vi.fn();
      render(
        <ParametersDropdown
          isOpen
          modelId={modelId}
          selectedParams={{}}
          onParamChange={onParamChange}
        />
      );
      expect(screen.getByText('图片背景')).toBeTruthy();
      expect(screen.queryByText('输出格式')).toBeNull();
      fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
      expect(screen.getByText('输出格式')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'WebP' }));
      expect(onParamChange).toHaveBeenCalledWith('output_format', 'webp');
      fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
      expect(screen.queryByText('输出格式')).toBeNull();
    }
  );

  it.each(['gpt-image-2', 'gpt-image-2-vip'])(
    'does not add an advanced toggle to %s',
    (modelId) => {
      render(
        <ParametersDropdown
          isOpen
          modelId={modelId}
          selectedParams={{}}
          onParamChange={vi.fn()}
        />
      );
      expect(screen.queryByRole('switch', { name: '高级功能' })).toBeNull();
    }
  );

  it.each([
    ['veo3.1', '生成音频', 'generate_audio'],
  ])('lets %s select an optional boolean and restore the upstream default', (modelId, label, id) => {
    const onParamChange = vi.fn();
    const { rerender } = render(<ParametersDropdown isOpen modelId={modelId} selectedParams={{}} onParamChange={onParamChange} />);
    if (modelId === 'veo3.1') fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    expect(screen.getByRole('button', { name: `${label}默认` }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: `${label}开启` }));
    expect(onParamChange).toHaveBeenCalledWith(id, 'true');
    rerender(<ParametersDropdown isOpen modelId={modelId} selectedParams={{ [id]: 'false' }} onParamChange={onParamChange} />);
    expect(screen.getByRole('button', { name: `${label}关闭` }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: `${label}关闭` }));
    expect(onParamChange).toHaveBeenCalledWith(id, 'false');
    fireEvent.click(screen.getByRole('button', { name: `${label}默认` }));
    expect(onParamChange).toHaveBeenCalledWith(id, '');
  });

  it('clears advanced values when advanced functionality is turned off', () => {
    const onParamChange = vi.fn();
    render(
      <ParametersDropdown
        isOpen
        modelId="gpt-image-2.5"
        selectedParams={{
          output_format: 'jpeg',
          output_compression: '80',
          moderation: 'low',
          user: 'user-1',
        }}
        onParamChange={onParamChange}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));

    expect(onParamChange).toHaveBeenCalledWith('output_format', '', {
      keepOpen: true,
    });
    expect(onParamChange).toHaveBeenCalledWith('output_compression', '', {
      keepOpen: true,
    });
    expect(onParamChange).toHaveBeenCalledWith('moderation', '', {
      keepOpen: true,
    });
    expect(onParamChange).toHaveBeenCalledWith('user', '', { keepOpen: true });
  });

  it('does not add an advanced toggle to unrelated models', () => {
    render(
      <ParametersDropdown
        isOpen
        modelId="gemini-3-pro-image-preview"
        selectedParams={{}}
        onParamChange={vi.fn()}
      />
    );
    expect(screen.queryByRole('switch', { name: '高级功能' })).toBeNull();
  });
});


describe('Tuzi automatic reference controls', () => {
  it.each(['gemini-omni-1.2-flash', 'wan3.0-video', 'kling-4.0'])('does not ask for duplicate media in %s', (modelId) => {
    render(<ParametersDropdown isOpen modelId={modelId} selectedParams={{
      reference_mode: 'frames', video_media: '[{"type":"refer_image","url":"https://example.test/old.png"}]',
    }} onParamChange={vi.fn()} />);
    const advanced = screen.queryByRole('switch', { name: '高级功能' });
    if (advanced) fireEvent.click(advanced);
    expect(screen.queryByText('参考素材')).toBeNull();
    expect(screen.queryByText('参考模式')).toBeNull();
    expect(screen.queryByText(/素材:1/)).toBeNull();
    expect(screen.getByText('视频尺寸')).toBeTruthy();
  });
  it('restores Gemini legacy resolution and ratio independently', () => {
    const onParamChange = vi.fn();
    render(<ParametersDropdown isOpen modelId="gemini-omni-1.2-flash"
      selectedParams={{ size: '2160x3840' }} onParamChange={onParamChange} />);
    expect(screen.getByRole('button', { name: '4k', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: '9:16', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '720p' }));
    expect(onParamChange).toHaveBeenCalledWith('ratio', '9:16', { keepOpen: true });
    expect(onParamChange).toHaveBeenCalledWith('size', '720p');
  });
});
