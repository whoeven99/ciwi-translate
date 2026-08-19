// `/app` 直接渲染翻译页，不再 302 到 `/app/translate-v4`：那一跳会把 app.tsx 的
// loader 完整跑一遍（鉴权 + Shopify 语言查询）再把结果丢弃，纯浪费一个文档往返。
// `/app/translate-v4` 保留为别名。
// 新手引导已暂时关闭；新安装用户直接进入翻译首页。
//
// 这里直接复用 translate-v4 的 loader，不再单独 `authenticate.admin`：本路由曾为了拿
// `session.shop` 去入队 install 计量扫描而多鉴权一次，而 `app.tsx` 的
// `runAppInitialization` 已经在同一个请求里幂等入队，多出来的那次鉴权只是在关键路径上
// 多读一次 Turso `Session`。
export { default, loader } from "../app.translate-v4/route";
