# Change: Optimize page scrolling and navigation

## Why
普通页面的滚动被全局触摸与溢出规则拦截，页面跳转还会完整刷新应用，导致内容不可达和明显的启动等待。

## What Changes
- Restore native document scrolling for the home, creative center, and music station.
- Add lightweight History API navigation between the three ordinary pages.
- Preserve full workspace initialization when entering a board.
- Synchronize home section anchors and active navigation with document scrolling.
- Prefetch the lazy music station chunk during browser idle time.

## Impact
- Affected code: `apps/web/src/styles.scss`, `apps/web/src/app/app.tsx`, `apps/web/src/home/HomePage.tsx`, `apps/web/src/creative-center/CreativeCenterPage.tsx`.
- The canvas workspace keeps its existing internal scrolling and persistence behavior.
