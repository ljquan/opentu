import type {
  ImageProps,
  PlaitImageBoard,
  RenderComponentRef,
} from '@plait/common';
import { PlaitBoard } from '@plait/core';
import { createRoot } from 'react-dom/client';
import { Image } from './components/image';
import { withImage3DTransform } from './with-image-3d-transform';
import { withImagePlugin } from './with-image';
import { withTextPastePlugin } from './with-text-paste';
import { withSvgVectorHit } from './with-svg-vector-hit';

export const withCommonPlugin = (board: PlaitBoard) => {
  const newBoard = board as PlaitBoard & PlaitImageBoard;

  newBoard.renderImage = (
    container: Element | DocumentFragment,
    props: ImageProps
  ) => {
    const root = createRoot(container);
    root.render(<Image {...props}></Image>);
    let newProps = { ...props };
    const ref: RenderComponentRef<ImageProps> = {
      destroy: () => {
        setTimeout(() => {
          root.unmount();
        }, 0);
      },
      update: (updatedProps: Partial<ImageProps>) => {
        newProps = { ...newProps, ...updatedProps };
        root.render(<Image {...newProps}></Image>);
      },
    };
    return ref;
  };

  // 应用插件链：先处理文本粘贴和图片，再统一 3D 图片几何
  return withImage3DTransform(
    withSvgVectorHit(withTextPastePlugin(withImagePlugin(newBoard)))
  );
};
