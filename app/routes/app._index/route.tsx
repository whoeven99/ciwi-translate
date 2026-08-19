// `/app` 直接渲染翻译页，不再 302 到 `/app/translate-v4`：那一跳会把 app.tsx 的
// loader 完整跑一遍（鉴权 + Shopify 语言查询）再把结果丢弃，纯浪费一个文档往返。
// `/app/translate-v4` 保留为别名。
// 新手引导已暂时关闭；新安装用户直接进入翻译首页。
//
// 页面 loader 已不再二次鉴权/拉语言：父级 `app.tsx` 统一提供 `shopLocales`，
// 本文件只 re-export translate-v4 的轻量 loader + 页面组件。
export { default, loader } from "../app.translate-v4/route";
