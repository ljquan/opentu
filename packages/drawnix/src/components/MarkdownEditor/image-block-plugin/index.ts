import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { markdownImageBlockSchema } from './schema';
import { markdownImageBlockView } from './view';

export { markdownImageBlockSchema } from './schema';
export { markdownImageBlockView } from './view';

export const markdownImageBlockPlugins: MilkdownPlugin[] = [
  markdownImageBlockSchema.node,
  markdownImageBlockSchema.ctx,
  markdownImageBlockView,
].flat();
