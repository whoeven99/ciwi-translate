# 首次翻译新手引导方案

## 1. 背景

当前 App 的默认入口会直接进入翻译页面，用户虽然已经具备创建翻译任务、查看覆盖率、开启试用和订阅付费的能力，但首次安装用户往往还没有建立清晰认知：

- 不知道系统已经识别了哪些店铺信息
- 不知道应该先翻译哪些语言和模块
- 不知道当前翻译覆盖率如何
- 不知道预计会消耗多少积分和时间
- 不知道下一步应该开启试用、直接翻译，还是先去订阅

因此需要新增一个面向首次安装用户的引导流程，在不增加过多操作负担的前提下，将“店铺理解 → 翻译建议 → 试用转化 / 创建首个任务”串成一条更顺滑的首次体验路径。

## 2. 文档目标

本方案用于定义一个可落地的首次翻译新手引导功能，包括：

- 产品目标与用户价值
- 页面流程与交互设计
- 数据来源与推荐逻辑
- 路由、状态和接口设计
- MVP 范围、埋点指标与实施顺序

## 3. 功能定位

该功能不是传统问卷，也不是独立业务模块，而是一个首次进入 App 时的前置引导层。

它的定位是：

- 对首次安装用户展示“系统已经为你准备好什么”
- 自动完成大部分分析，不要求用户填写大量信息
- 将用户尽快推进到“开启试用”或“创建首个翻译任务”
- 支持跳过，不打断熟练用户

## 4. 目标用户

### 4.1 主要用户

- 首次安装 App 的 Shopify 商家
- 尚未完成首次翻译任务的用户
- 对多语言设置、翻译流程、积分消耗认知不完整的用户

### 4.2 非目标用户

- 已完成 onboarding 的老用户
- 已有成熟翻译流程的重复访问用户
- 已经在 App 内创建过首个任务并持续使用的商家

## 5. 产品目标

### 5.1 业务目标

- 提升首次安装用户的试用开启率
- 提升首次安装用户的首个翻译任务创建率
- 缩短从安装到首次任务创建的时间
- 提升用户对推荐语言、覆盖率和成本预估的理解

### 5.2 用户目标

- 快速知道“我应该翻哪些语言”
- 快速知道“我目前店铺翻译情况怎么样”
- 快速知道“我要花多少积分、多少时间”
- 能一键继续到试用或创建任务，而不是来回切页面

## 6. 核心设计原则

1. 自动化优先  
   能由系统推断的内容，不要求用户手动填写。

2. 转化优先  
   页面最终目标是促成试用开启或首个任务创建。

3. 轻量感优先  
   不做冗长问卷，不让用户觉得在做复杂设置。

4. 支持降级  
   即使扫描数据不完整，也要能输出可用的推荐结果。

5. 可跳过  
   用户可以跳过当前引导，后续不应高频重复打扰。

## 7. 总体流程

### 7.1 入口判断

当用户进入 `/app` 时，系统先判断是否进入 onboarding：

- 用户属于首次引导目标人群
- 尚未完成 onboarding
- 尚未明确跳过 onboarding
- 尚未创建首个翻译任务

满足条件时跳转至 `/app/onboarding`，否则维持当前默认流程进入 `/app/translate-v4`。

### 7.2 页面流程

建议将 onboarding 收敛为 2.5 步：

1. `Preparing`  
   展示欢迎信息与系统自动准备过程
2. `Recommendation`  
   展示推荐语言、覆盖率、优化建议、积分与时间预估
3. `Action`  
   根据用户当前状态触发试用、创建任务或升级

这里的“2.5 步”强调过程感，而不是让用户手动点很多下一步。

## 8. 页面方案

## 8.1 Step 1: Welcome + Preparing

### 页面目标

- 给首次用户一个清晰的欢迎感
- 告诉用户系统正在自动准备翻译方案
- 承接后续推荐页，避免突兀跳转

### 建议文案方向

- Welcome to CIWI Translate
- We are preparing the best translation setup for your store

### 建议展示的进度项

- 正在识别商店内容结构
- 正在加载可翻译数据
- 正在确认市场、语言与货币
- 正在分析当前翻译覆盖率
- 正在生成适合你商店的翻译建议

### 交互要求

- 页面不要求用户输入信息
- 最短停留建议 1.5 到 2.5 秒
- 进度展示尽量和真实数据加载过程绑定
- 如果部分数据暂未完成，也要能平滑进入下一步

## 8.2 Step 2: Recommendation

这是 onboarding 的核心步骤，目标是让用户迅速形成“系统已经帮我想好了下一步”的认知。

推荐拆成 3 个信息区块。

### A. Recommended Languages

展示内容：

- AI / 系统建议翻译的目标语言
- 推荐这些语言的原因
- 各语言对应的本地化重点说明

建议说明维度：

- 该语言与当前市场配置的匹配关系
- 该区域用户的语言偏好
- 本地化表达风格或语言习惯

输出示例：

- German: 适合你当前的欧洲市场配置
- French: 对法语地区客户转化更友好
- Japanese: 本地买家更依赖原生语言商品信息

### B. Store Translation Health

展示内容：

- 店铺当前翻译覆盖率
- 翻译缺口最大的语言或模块
- 当前存在的翻译问题
- 推荐优先优化方向

表达方式建议偏正向：

- Your store is partially translated
- Product content has the largest untranslated gap
- Navigation and market-facing pages can be improved next

避免过强的负面表述，比如“你的翻译做得很差”。

### C. Estimated Cost & Time

展示内容：

- 本次推荐翻译任务预计消耗的积分
- 预计耗时
- 推荐模块范围
- 如果只翻优先模块，可节省多少积分

该区块直接承接 CTA，是促成转化的关键。

## 8.3 Step 3: Action

页面底部只保留一个主 CTA、一个次 CTA 和一个跳过动作。

### 主 CTA

根据用户状态动态变化：

- 有试用资格但积分不足：`Start 5-day free trial`
- 已有足够积分：`Create my first translation task`
- 无试用资格且积分不足：`Upgrade and continue`

### 次 CTA

- `Customize settings`

用于高级用户手动调整推荐语言、模块和翻译模式。

### 辅助操作

- `Skip for now`

用户跳过后，应记录状态，避免在短时间内重复打断。

## 9. 推荐逻辑

## 9.1 推荐语言逻辑

MVP 采用三层兜底策略：

1. 市场配置优先  
   优先根据 Shopify Markets / 已配置 locale 输出建议

2. 已发布语言次之  
   如果市场配置不完整，则依据当前店铺 locale 配置推荐

3. 默认推荐兜底  
   当上述数据不足时，使用默认推荐语言规则

## 9.2 推荐模块逻辑

优先推荐高价值、首轮最适合落地的模块：

- Product
- Collection
- Menu / Navigation
- Page

若扫描结果已包含模块字符量与覆盖率，则按内容量和翻译缺口排序；
若无扫描结果，则使用默认模块集。

## 9.3 个性化建议逻辑

如果 `shop scan` 的理解结果已准备好，可补充以下个性化信息：

- 店铺行业与子行业
- 品牌定位和语气风格
- 目标市场关注点
- 模块级翻译策略建议

如果上述数据缺失，则页面降级为基础推荐版本，不阻塞用户继续操作。

## 10. 数据依赖

该功能优先复用现有系统能力，不重复建设底层逻辑。

### 10.1 可复用数据

- App bootstrap 中的 plan / trial / credits / isNew
- Shop locales 与 source / target locales
- shop scan 的市场、理解、signals、coverage、module stats
- 创建任务前的积分预估能力
- 现有试用、订阅和配额拦截逻辑

### 10.2 降级策略

当以下数据不可用时，页面仍可继续：

- `shop scan` 未完成：使用基础语言推荐和默认模块推荐
- coverage 未准备好：展示“正在计算覆盖率”或隐藏部分分析卡片
- estimate 失败：展示保守预估或仅展示推荐语言与试用入口

## 11. 数据模型设计

建议新增独立的 onboarding 状态记录，不直接复用 `isNew`。

原因：

- `isNew` 当前语义更接近“是否从未激活过订阅/试用”
- 不能准确表示是否看过 onboarding
- 不能表示是否跳过 onboarding
- 不能表示是否已从 onboarding 创建了首个任务

建议数据结构如下：

```ts
type OnboardingStatus =
  | "not_started"
  | "preparing"
  | "recommended"
  | "skipped"
  | "completed";

type ShopOnboardingState = {
  shop: string;
  status: OnboardingStatus;
  firstEnteredAt: string | null;
  skippedAt: string | null;
  completedAt: string | null;
  startedTrialFromOnboarding: boolean;
  createdFirstTaskFromOnboarding: boolean;
  recommendedTargets: string[];
  recommendedModules: string[];
  estimateCredits: number | null;
  estimateMinutes: number | null;
  sourceScanId: string | null;
};
```

## 12. 路由与接口设计

## 12.1 路由建议

- `/app`
  - 当前默认入口
  - 增加是否重定向到 `/app/onboarding` 的判断

- `/app/onboarding`
  - 新增 onboarding 页面路由

## 12.2 Loader / API 建议

建议使用聚合 loader 或聚合接口，不建议前端在页面内并行拼多个接口。

可选方案：

- 方案 A：`/app/onboarding` loader 直接返回完整数据
- 方案 B：页面 loader 返回基础数据，页面再调用 `/api/onboarding/summary`

MVP 更推荐方案 A，逻辑更集中。

### 推荐返回结构

```ts
type OnboardingSummary = {
  shop: string;
  onboardingState: ShopOnboardingState | null;
  bootstrap: {
    planType: string;
    isNew: boolean | null;
    isInFreePlanTime: boolean;
    remainingCredits: number;
  };
  locales: {
    source: string;
    availableTargets: string[];
    suggestedTargets: string[];
  };
  markets: Array<{
    name: string;
    locales: string[];
    currency: string | null;
  }>;
  coverage: {
    overallPercent: number | null;
    untranslatedRatioByLocale: Record<string, number | null>;
    topGaps: string[];
  } | null;
  recommendation: {
    suggestedModules: string[];
    reasons: string[];
    localizationNotes: Array<{
      locale: string;
      note: string;
    }>;
  };
  estimate: {
    credits: number | null;
    minutes: number | null;
    needsMoreCredits: boolean;
  } | null;
};
```

## 13. CTA 行为设计

## 13.1 有足够积分

动作链路：

1. 使用推荐配置直接创建首个翻译任务
2. 创建成功后更新 onboarding 状态为 `completed`
3. 跳转到 `/app/translate-v4`
4. 高亮刚创建的任务

## 13.2 有试用资格但积分不足

动作链路：

1. 触发 5 天试用
2. 试用成功后自动继续创建推荐任务
3. 创建成功后更新 onboarding 状态
4. 跳转任务页

关键要求：  
用户开启试用后，不应再手动回到页面重新点击“创建任务”。

## 13.3 无试用资格且积分不足

动作链路：

1. 跳转订阅 / pricing
2. 用户订阅成功后可返回翻译页或继续自动恢复到推荐任务创建动作

## 13.4 Skip

动作链路：

1. 更新 onboarding 状态为 `skipped`
2. 直接进入 `/app/translate-v4`
3. 后续不再高频弹出
4. 可在首页保留轻入口，例如 `Finish setup`

## 14. UI 建议

### 14.1 整体风格

- 采用轻量、扁平、信息明确的设计
- 不要像“长问卷”，更像“系统为你准备的启动页”
- 推荐使用卡片化布局，降低阅读负担

### 14.2 Step 1 视觉

- 大欢迎语
- 中间进度状态
- 底部轻提示

### 14.3 Step 2 视觉

建议 3 张核心卡片并列或上下布局：

- Recommended Languages
- Store Translation Health
- Estimated Cost & Time

### 14.4 文案风格

- 正向、清晰、可信
- 少营销口号，多下一步建议
- 强调“系统已经替你准备好”

## 15. 埋点与成功指标

建议至少记录以下事件：

- onboarding_viewed
- onboarding_preparing_completed
- onboarding_recommendation_viewed
- onboarding_trial_clicked
- onboarding_task_created
- onboarding_skipped
- onboarding_upgrade_clicked

建议关注以下核心指标：

1. 首次安装用户进入 onboarding 的比例
2. 到达 recommendation 页的比例
3. 点击试用 / 创建任务 CTA 的比例
4. 成功创建首个任务的比例
5. 从安装到首任务创建的平均耗时

## 16. MVP 范围

### 16.1 本期必须实现

- `/app` 到 `/app/onboarding` 的条件跳转
- onboarding 状态存储
- onboarding 页面基础 UI
- Preparing 页
- Recommendation 页
- 推荐语言展示
- 覆盖率摘要展示
- 积分预估展示
- 试用 / 创建任务 / 升级 CTA
- Skip 状态记录
- 埋点统计

### 16.2 可延期能力

- 更复杂的 AI 个性化文案
- 行业级本地化建议扩展
- 货币与市场高级建议
- 引导后的 checklist
- 邮件 / 站内消息联动
- 试用成功后的自动恢复动作持久化

## 17. 风险与注意事项

### 17.1 shop scan 时效问题

`shop scan` 可能尚未完成，因此 onboarding 不应强依赖完整扫描结果。推荐逻辑必须支持降级。

### 17.2 首屏不可过重

Preparing 页面要有仪式感，但不能拖慢用户开始操作。避免长时间停留和过多动画。

### 17.3 转化链路不能断

试用开启后应尽量自动继续到任务创建，否则会造成明显流失。

### 17.4 Skip 后避免反复拦截

如果用户已经跳过，应控制再次出现频率，避免造成干扰。

### 17.5 推荐文案要可信

个性化建议如果表达得过满，而数据来源不足，会降低用户信任。MVP 阶段更适合保守、可解释的推荐。

## 18. 推荐实施顺序

1. 设计并落地 onboarding 状态表
2. 改造 `/app` 默认入口判断逻辑
3. 新增 `/app/onboarding` 路由与 loader
4. 聚合 bootstrap、locales、coverage、estimate 数据
5. 完成 Preparing 与 Recommendation 页面
6. 接入试用 / 订阅 / 创建任务联动
7. 增加埋点与转化追踪
8. 再补充 AI 个性化增强内容

## 19. 结论

首次翻译新手引导功能的本质，不是新增一个说明页，而是把当前系统已具备的翻译、扫描、试用和任务创建能力重新编排成一条更适合首次用户的路径。

只要控制好三点，这个功能就很有机会成为首转化提升点：

- 自动分析，不让用户做太多选择
- 推荐足够清晰，能回答“我现在该做什么”
- 试用与创建任务之间尽量无缝衔接

建议以 MVP 先验证首个任务创建率和试用转化率，再决定是否继续扩展为更强的 AI 个性化 onboarding 方案。
