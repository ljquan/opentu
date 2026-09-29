// esbuild 以 text loader 把 .css 打成字符串
declare module "*.css" {
    const css: string;
    export default css;
}

// 重依赖从 CDN 动态加载,不打进 bundle;此处声明以便 TS 提示
declare module "https://esm.sh/marked@14" {
    export const marked: { parse: (src: string) => string };
}
