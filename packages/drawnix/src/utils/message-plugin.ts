import 'tdesign-react/es/message/style/css';
import { flushSync } from 'react-dom';

type TDesignMessagePlugin =
  typeof import('tdesign-react/es/message')['MessagePlugin'];
type MessageMethod = Exclude<keyof TDesignMessagePlugin, 'close'>;
type MessageArgs = [unknown, number?];
type MessageInstanceLike = { close?: () => void } | null | undefined;
type ResolvedMessageInstanceLike = NonNullable<MessageInstanceLike>;
type LazyMessageInstance = Promise<MessageInstanceLike> & {
  __aituLazyMessageInstance: true;
  instancePromise: Promise<MessageInstanceLike>;
};

let messagePluginPromise: Promise<TDesignMessagePlugin> | null = null;

function loadMessagePlugin(): Promise<TDesignMessagePlugin> {
  if (!messagePluginPromise) {
    messagePluginPromise = import('tdesign-react/es/message').then(
      (module) => module.MessagePlugin
    );
  }
  return messagePluginPromise;
}

function isLazyMessageInstance(value: unknown): value is LazyMessageInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as LazyMessageInstance).__aituLazyMessageInstance === true
  );
}

function isPromiseLikeMessageInstance(
  value: unknown
): value is Promise<MessageInstanceLike> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<MessageInstanceLike>).then === 'function'
  );
}

function isResolvedMessageInstance(
  value: unknown
): value is ResolvedMessageInstanceLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NonNullable<MessageInstanceLike>).close === 'function'
  );
}

function callMessage(method: MessageMethod, args: MessageArgs): void {
  void loadMessagePlugin()
    .then((plugin) => {
      const handler = plugin[method] as (...handlerArgs: MessageArgs) => unknown;
      handler(...args);
    })
    .catch((error) => {
      console.warn('[MessagePlugin] failed to load tdesign-react:', error);
    });
}

export const MessagePlugin = {
  success(...args: MessageArgs): void {
    callMessage('success', args);
  },
  error(...args: MessageArgs): void {
    callMessage('error', args);
  },
  warning(...args: MessageArgs): void {
    callMessage('warning', args);
  },
  info(...args: MessageArgs): void {
    callMessage('info', args);
  },
  loading(...args: MessageArgs): LazyMessageInstance {
    const instancePromise = loadMessagePlugin().then((plugin) => {
      const loading = plugin.loading as (...handlerArgs: MessageArgs) => unknown;
      let instance: ReturnType<TDesignMessagePlugin['loading']> | undefined;
      // TDesign ignores close() until its React root has mounted. Commit the
      // loading toast before exposing the instance, including on cached imports.
      // This callback runs in a microtask, outside React's render lifecycle.
      flushSync(() => {
        instance = loading(...args) as ReturnType<TDesignMessagePlugin['loading']>;
      });
      return instance;
    });

    return Object.assign(instancePromise, {
      __aituLazyMessageInstance: true,
      instancePromise,
    } as const);
  },
  close(instance?: unknown): void {
    if (isLazyMessageInstance(instance)) {
      void instance.instancePromise
        .then((resolvedInstance) => {
          resolvedInstance?.close?.();
        })
        .catch((error) => {
          console.warn('[MessagePlugin] failed to close lazy message:', error);
        });
      return;
    }

    if (isResolvedMessageInstance(instance)) {
      instance.close?.();
      return;
    }

    if (!isPromiseLikeMessageInstance(instance)) {
      return;
    }

    void loadMessagePlugin()
      .then((plugin) => {
        plugin.close(instance as never);
      })
      .catch((error) => {
        console.warn('[MessagePlugin] failed to load tdesign-react:', error);
      });
  },
};
