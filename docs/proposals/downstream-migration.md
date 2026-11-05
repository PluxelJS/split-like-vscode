# 财务宿主迁移任务

以下内容可直接作为新 session 的任务。它规定财务应用的迁移范围与验收；库的 API 和语义以现行文档为准，不在这里复制第二份接口契约。

## 任务与边界

请把当前 financial-review-workbook 的 Worksplit 消费者完整迁移到 `vendor/split-like-vscode` 已完成稳定性修订的新实现，清理旧接线与重复协调，直到真实宿主通过验收。
先读根仓库 AGENTS.md、README.md、docs/architecture.md、docs/features/workspace.md、VALIDATION.md，以及库的
[README](../../README.md)、[架构](../architecture.md)、[行为](../vscode-workbench-behavior.md)、
[资源](../resource-lifetimes.md)、[原生依赖支持](../navigation-support.md)和[当前交付状态](README.md)。

沿用当前个人分支，核对根仓库和子模块的实际 HEAD、工作区、跟踪及 gitlink。
父仓库记录的旧 gitlink 和旧设计验收不能代表当前库实现；不要用 `git submodule update` 把实际新 checkout 回退。
迁移开始前保留现有 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 等工作区修改，区分已有人工作和本轮改动。
先迁移当前财务仓库；外部 Pluxel Shell/Studio 不属于这次任务，不能用库 demo 的成功代替其迁移。

使用 smallest-complete；操作 Pluxel 宿主按本地 pluxel-development skill 和 dev-console HMR batch 工作流。
不重设计会计、金额、账套归属、CAS、回执或共享草稿业务契约。可以删除旧 UI 接线和旧接口，不做运行时兼容 shim。
发现库的确定缺陷时先最小复现并修在所属边界，不能在业务层绕过保护或复制一套协调器。

## 依赖先成立

根 workspace/catalog/lock 仍是唯一依赖入口，按根仓库规则通过 Pluxel pncat 管理。
包只有 `@worksplit/react` 与独立的 `@worksplit/split-view`；删去已经不存在的 core workspace 引用。
按实际消费者决定是否引入 SplitView，不为保持旧目录而添加依赖。

核对原生支持文档声明的精确版本与完整修正：当前是 react-router 1.170.46、router-core 1.171.39、
history 1.162.5 和 FlexLayout 0.11.1。版本号相同不代表补丁已经安装。
Git workspace 消费应将库维护的完整补丁纳入根包管理器配置；制品消费使用包内离线安装器和 `--check`。
不要只复制以前的 FlexLayout 补丁或另写简化导航适配。确保唯一 React/Router/FlexLayout 实例，
在实际根安装上运行原生回归及源码/产物一致性检查；重建制品，不能继续验证遗留 dist。

## 按真实所有者迁移

优先盘点 `host/web/src/client/financial-project-owner.ts`、`financial-workspace.tsx`、
`financial-document.tsx`、`financial-routes.tsx`、`workspace-snapshot.ts`、`document-scope.ts`，
再沿实际引用覆盖工具、问题定位、可见性订阅和业务入口；不要只用编译报错作为迁移清单。

- **会话与退出。** 项目 owner 创建实例、显式 `start({ browser })`、消费启动结果；React 只绑定视图。
  正常离开使用 `closeWorkspace`，强制释放使用幂等 `dispose`。移除独立 connect/disconnect 接线，
  外部浏览器接管消费真实 href/state、可选最终快照及 cleanup。成功的业务写入与后续导航失败分别报告。
  项目独立编辑（例如 `datasetNames.editing`）由 `workspaceLeave` 保护，它不重复遍历文档 controller。
  应用仍拥有同步 beforeunload；删除旧 `hasApprovedHistoryDeparture`、href/signature 批准缓存，
  不把 signal 是否 abort 当作批准结果：成功的尝试也会结束自己的 signal。
- **内容与编辑。** 读取句柄改用 `useContent`；一个跨路由叶节点持续存在的 owner 使用
  `useContentController({ leave, save, focus, title })`。只读显式 `leave: null`，不要在 dirty 时才条件登记 owner。
  保留共享草稿/借用引用；token 代表实际审核或保存依据，pending write 仍可拒绝离开。
  保存期间新增编辑保持 dirty；每个请求用自己的 `request.defer` 释放暂停，不能相互解冻。
  `runEffect` 只接管内容借用的资源，共享服务和后台工作仍由项目 owner 负责。
- **路由与阅读返回。** 保留每文档原生 Router，以及既有同标签下探、筛选 push、口径 replace、
  `financialReadParent` 来源索引和没有父层时的业务回退。返回通过真实 history go/back/forward，
  不增加影子返回栈、额外 href 批准表或二次确认。params/search/hash 与业务资源连续驻留身份分别保留。
- **打开与放置。** 把普通入口集中到现有业务 owner/helper，使用 open/createLink、source、destination、
  reuse、preview、presentation。常用旁开使用 `beside`，财务 2×2、588px 和比例限制继续属于应用策略。
  直接复用原生目标、DockLocation、index；不把库的旧 placement 字段机械改名后保留旧执行链。
  已选中的具体报告副本用 activate；重复 key 是正常现象，删除 identity-conflict 处理。
  默认身份已经使用原生 path/search；只有实际业务复用语义需要时才声明 documentKey。
- **结果与焦点。** Worksplit 异步操作消费 applied/denied/superseded/failed，applied 的值在 value 中，
  清理失败和已发生的部分效果不得当作未执行。链接反馈交明确的 onResult 或调用者；无 handler 的原生 drop 由库报告。
  原生 `router.navigate`、history go/back/forward 保留各自契约；业务资源引用跟随实际接纳位置，
  不能把 history 已改写或一条 Promise 完成当作对应 Router 已接纳业务资源。
  工具揭示/聚焦使用 activate；问题定位使用本次 focus 回调，删除业务层 rAF 猜测与多步 select/maximize/focus 拼接。
- **标题、可见性与菜单。** 自动标题由 controller/route/tool 声明，手动标题使用原生 name/Actions。
  删除根据文本相等猜自动标题的 Map；富文本标题装饰原生最终名称，保持 aria/overflow 一致。
  可见性用稳定只读查询与 selector，不逐文档导出布局。默认菜单已完整；业务只定制原生条目和呈现，
  保留原生翻译以及 onClose/onClosed 的真实焦点交接，不在 renderer 再执行一套批准流程。
- **恢复与存储。** 初始布局/快照放入 initial，显式 createSnapshot 才导出。
  财务使用稳定项目 workspaceId；宿主保留存储 envelope、产品政策、节流和错误展示，库验证 unknown 快照结构。
  删除重复的库 schema 验证和运行时布局镜像；writer 订阅 snapshotRevision。
  财务启用 `captureSnapshotOnClose`，使用 closeWorkspace 结果或浏览器 handoff 中的最终快照保存布局；
  收束旧 writer 的待写任务，不能让它随后覆盖最终快照，也不能在实例终止后再次 createSnapshot。
  v2 不转换旧布局；旧布局的不兼容需要明确重置入口，不能静默丢弃草稿或其他业务数据。

## 验收和交付

先定向证明正确接线，再跑根仓库规定的聚合 verify。依据实际声明宿主做桌面、窄窗格和真实 2×2 验收，
至少覆盖以下会改变业务结果或使用体验的路径：

1. 普通打开、旁开预览、保留、复制、多副本选择、跨中央/Border 移动、工具揭示及菜单键盘入口。
2. 同标签下探→中间筛选→返回来源、直接地址业务回退、原生/浏览器返回拒绝与允许、外部范围退出。
3. dirty、无 dirty 但写入待确认、保存中新增编辑、批量关闭第二成员拒绝、共享草稿被多个内容借用。
4. 慢链接后用户切页、预览批准期间切页、浏览器返回待批准期间后台打开；晚到结果不能抢回前台。
5. 手动名恰好等于自动名后导航/恢复、可见性切换、问题定位、菜单退出动画、实际拖放失败反馈。
6. 最终快照保存/恢复、损坏及旧版本明确拒绝、项目身份不匹配、资源释放和晚到资源清理。

库回归、制品浏览器和真实财务宿主分别记录；未运行项明确保留，不能沿用旧验收计数。
最后清理旧 imports/API、过时适配、重复状态和文档，将根工作台契约与 VALIDATION.md 更新为实际状态。
只提交本轮内容；父 gitlink 随已验证的消费者适配一起更新。远端发布、推送和合并按当次授权执行。
交付说明改了什么、删了哪些旧接线、验证证据、剩余边界及实际提交。
