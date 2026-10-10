# Worksplit 内部重构验收

验收日期：2026-10-10。范围是 Worksplit 库与自有 demo；Pluxel、第二应用及跨应用兼容性没有接入或验收。

## 隔离与交付位置

- 原仓库：`/home/ahdg/code/shinium/pluxel/vendor/split-like-vscode`，原分支 `main`，基线 `e60793224804dc803f4bf216083b5626029c2a80`。
- 独立 worktree：`/home/ahdg/code/shinium/worksplit-flexlayout-tanstack`。
- 分支：`refactor/flexlayout-tanstack`。
- 启动命令：在新 worktree 执行 `pnpm --filter @worksplit/demo dev --port 5188 --strictPort`。
- 运行地址：[localhost:5188](http://localhost:5188/)；同一网络也可访问 [192.168.2.216:5188](http://192.168.2.216:5188/)。端口在启动前确认空闲，服务绑定 `0.0.0.0`。

创建前，原 Worksplit 仅有未提交的 `refactor/README.md`。先读取，再原样复制到新 worktree，核对 SHA-256：
`c01e5bb13bd0c60bf76ca53ebec9b9bf809b112a7b784aed2972f7575e921c36`。
此后设计状态和实际行为说明只在新 worktree 更新。原文件仍保持该哈希。

原 Pluxel 的 ` M vendor/split-like-vscode` 和其已偏离记录的子模块位置 `+e607932…` 保持原状。
没有改 Pluxel 源码、依赖、索引或子模块指针，没有推送、合并或发布。

## 实施结果与版本证据

采用一个集成实例、一个原生 Model，以及每文档独立的真实 Router/memory history。
公共入口、用法由 [README](../README.md) 维护，行为及迁移归属由
[行为契约](../docs/vscode-workbench-behavior.md) 维护。本记录只列证据与限制。

| 依赖                                           | 实际锁定版本                  |
| ---------------------------------------------- | ----------------------------- |
| flexlayout-react                               | 0.11.1                        |
| @tanstack/react-router / router-core / history | 1.170.42 / 1.171.35 / 1.162.5 |
| @tanstack/react-store / store                  | 0.11.2 / 0.11.2               |
| @tanstack/react-hotkeys / hotkeys              | 0.13.0 / 0.11.0               |
| React / React DOM                              | 19.3.0 / 19.3.0               |
| TypeScript / Vite / Vitest                     | 7.0.2 / 8.3.3 / 5.0.3         |
| Playwright / Chromium                          | 1.64.0 / 156.0.8078.4         |
| Node / pnpm                                    | 24.21.0 / 11.8.0              |

版本核对来自安装后的 package 信息及 `pnpm-lock.yaml`。Router 和 FlexLayout 为 peer，demo 显式消费相同实例。
Store、Hotkeys 在库中使用；Hotkeys、Store 和 Model 没有另造事件总线、路由表或布局树。
`packages/demo` 只导入公开包入口；Vite 与 TypeScript 的私有源码 alias 已删除。
生产 build 使用默认 dist exports，开发服务使用公开的 development condition。

被替代的 editor arrangement/grid、旧 Workbench model/editing/drag 实现和测试已删除；
独立 SplitView、Pane、core pane sizing 及其原有测试保留。
[发行说明](../.tegami/flexlayout-tanstack.md) 标明 core/react 的 major bump；未手改版本或 publish-lock。

## 检查结果

| 检查                                    | 结果                                                           |
| --------------------------------------- | -------------------------------------------------------------- |
| `pnpm lint`                             | 通过，0 warning / 0 error                                      |
| `pnpm typecheck`                        | core、react、demo 及工具配置通过；类型化导航的错误调用断言通过 |
| `pnpm test`                             | 33 项通过：core 5、SplitView 18、新协调 9、多 Router 1         |
| `pnpm build`                            | 三个包通过；生产 demo 从公开 dist 入口打包                     |
| `pnpm source-declarations:check`        | 通过，构建未在源码中遗留声明文件                               |
| `pnpm format:check`、`git diff --check` | 通过                                                           |
| `pnpm test:browser`                     | 21 项 Chromium 测试通过，0 skipped / unexpected / flaky        |
| 公开 dist JS smoke                      | 从 demo 包解析 `@worksplit/react`，打开、关闭、dispose 通过    |
| 删除符号与本地 Markdown 链接检查        | 通过；旧符号仅在迁移说明或设计语义中出现                       |

可见但未隐藏的提示：tsdown 提示 TypeScript 7 API 尚属 experimental；生产 demo 单个 JS chunk 为
561.58 kB（gzip 165.81 kB），超过 Vite 默认 500 kB 提示阈值；多 Router 的 jsdom 检查提示未实现
scrollTo。真实浏览器另外验证了滚动保留。未通过调高阈值或吞掉错误来消除提示。

原型先完成共享真实 route tree、两个并排文档、一个工具、类型推导和 dirty/redirect/history/race 门槛，
再删除旧引擎并扩大验收。最后窗口焦点断言移动到对应场景后单独补跑通过，保留完整 21 项结果文件。

## 浏览器交互证据

测试：[workbench.spec.mjs](../packages/demo/tests/workbench.spec.mjs)。
完整结果：[browser-results.json](acceptance/browser-results.json)。
截图：[桌面 1440×900](acceptance/desktop.png)、[窄屏 390×844](acceptance/narrow.png)。
截图来自实际测试过程，并经过目视复核。

| 场景                       | 观察与断言                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| 两个真实文档、嵌套路由     | 独立 params/search/loader/context、原生 hooks 与 Outlet；A 编辑不改变 B                         |
| 类型化入口和导航投影       | open 使用实际 route tree；metadata 归属与已提交文档更新，工具不触发反向导航                     |
| dirty 拒绝与 open redirect | 拒绝保留原地址和输入；redirect 到已打开 B 复用 B，dirty A 原样保留                              |
| 原生 Router blocker        | Worksplit receipt 明确 router-blocked，已提交 location 保留                                     |
| 连续后退与前进             | 两个待决确认拒绝后回到接受项，history.length 和 forward 栈保留；待决期间 open 明确 history-busy |
| 慢结果与焦点竞争           | 聚焦 B 或工具撤销抢焦点资格；原生快导航与后来的 open 取代慢结果                                 |
| 关闭期间编辑/导航          | 重复关闭只出现一份决策；新编辑由应用修订检查拒绝；新 route 内容使旧关闭批准失效                 |
| 关闭后的晚到结果           | 不复活节点或写回 URL；最后一个文档关闭后保留空目录、工具和空焦点记录                            |
| 原生移动与隐藏             | 跨组、Border、pin、最大化、隐藏后输入、scrollTop=480、挂载和业务订阅数保留                      |
| 真实鼠标拖放               | 使用原生 drag 事件流将 A 移到 B 组；保留输入与活动组                                            |
| 全局工具                   | 工具隐藏与中央停靠保留输入，不接管文档 URL；Portal 命令保留 inspector 上下文                    |
| 命令                       | Ctrl+S 只保存活动文档；工具输入焦点下仍正确指向文档，未广播保存                                 |
| 原生 redirect 身份冲突     | 明确报告 native-identity-conflict，两个实例继续存活，没有静默合并/关闭                          |
| 错误隔离                   | loader 和 renderer 失败只影响各自实例，另一可见文档继续工作                                     |
| 可选快照                   | 刷新以地址栏激活，拒绝不兼容数据并提供明确 reset；恢复关闭后不复用旧 history hint               |
| 窄屏                       | 切换 A/B、保留 draft 与挂载；恢复原桌面 maximize 偏好，底部动作可滚动到达                       |
| 销毁                       | 业务订阅与 document history subscriptions 归零；整个实例 dispose 后存活 Router 归零             |

纯策略的 admission、程序单 tab/整组移动、快照拒绝在单元测试中验证；原生 preview 连接同一策略的
接入点经源码核对。实际鼠标拖放由浏览器验收覆盖。窗口失焦/恢复场景使用真实页面的事件观察器，
但事件由测试注入；没有验证操作系统层面的应用切换。触屏手势、其他浏览器及 React 18 未验收。

## 根据上游证据收窄的语义

1. **最终 redirect 去重只保证 open。** 原生 Router load 提交匹配后才通知 resolved，无法在普通
   Link/navigate 的该通知中保证提交前去重与保留旧内容。原生入口冲突明确报告并保留两个实例。
   没有复制 Router 导航流水线或手写路由分发。
2. **拒绝回执来自公开 memory history blocker 观察。** 当前上游原生 navigate Promise 在拒绝时
   可能悬挂；Worksplit 为自己的 receipt 观察 blocker 结果，不改上游内部。原生调用方仍遵循上游行为。
3. **拒绝未审计的移除与改写入口。** 整组关闭、分组、任意节点/config/批量 Action、floating/popout
   没有实现另一套事务或布局算法；这些入口禁用/拒绝，单文档关闭走同一协调路径。
4. **历史限定于 owned scope。** 使用 indexed state 和原生 history.go 回滚；待决遍历期间新 open
   返回 history-busy。外部历史项报告 history-outside-scope，宿主必须处理退出/卸载。
5. **原生呈现槽属于可信扩展。** 上游 Node.getModel 可达可变 Model，不能用 readonly 假称隔离。
   普通内容只取得窄能力；可信槽不得绕过协调改 Model。
6. **窄屏使用临时 native maximize。** 不引入移动端布局树；snapshot 与拓宽恢复桌面选择。

这些取舍已同步到用法、行为契约、设计状态、测试及 demo。pending loader 可能继续；会话/操作检查
只保证晚到结果不获准提交给已关闭实例，不宣称实现了真正取消。

## 文档数量与资源成本

脚本：[measure-workbench.mjs](../scripts/measure-workbench.mjs)；原始结果：
[measurements.json](acceptance/measurements.json)。最后一轮测量使用实际 Chromium、Vite development、本地 HTTP，
暖服务器/模块缓存与独立冷浏览器上下文。Linux x64，Intel i5-11400H @ 2.70 GHz，Node 24.21.0。

1440×900、两个可见组、零注入网络延迟、staleTime Infinity；每个新文档先显示，再进行下一次打开。
20 次切换，每次 open/switch 等待两个 RAF；随后 resize 到 1280×800，最后逐个 await close。
追加打开时间排除第一个启动文档，包含之后 N−1 个文档及绘制等待；计数包含第一个文档。

| 文档数 | HTTP/loader | 提交渲染 | 切换额外渲染 | 业务 / history 订阅 | 追加打开 ms | 20 次切换 ms | close 回执 / 含绘制 ms |
| ------ | ----------- | -------- | ------------ | ------------------- | ----------- | ------------ | ---------------------- |
| 2      | 2           | 2        | 0            | 2 / 2               | 66.7        | 666.6        | 28.4 / 33.2            |
| 10     | 10          | 10       | 0            | 10 / 10             | 684.5       | 783.1        | 152.6 / 161.9          |
| 50     | 50          | 50       | 0            | 50 / 50             | 3751.4      | 1433.4       | 778.8 / 850.7          |

三个数量下，切换和 resize 均未新增文档 loader、提交渲染或挂载；关闭后业务/history 订阅归零，
卸载数等于文档数，close cleanupErrors 全部为零。关闭文档后仍有一个无 loader/订阅的 URL builder
Router，属于实例寿命；实例 dispose 的浏览器测试验证它也被释放。

这些是一次最终采样，不是生产环境吞吐、峰值内存、P95 或性能优秀的证明。切换时间包含 RAF 等待，
不是纯 CPU 时间；渲染计数是业务组件提交 effect，不覆盖 speculative render 或全部 shell 渲染。
订阅计数覆盖 demo 业务服务与公开 history.subscribers，不穷举 Router/React Store 内部订阅。
单文档一个 Router 的资源与关闭成本随数量增长；50 个文档的逐个关闭已达到约 779 ms。

堆读数来自 CDP Performance，无强制 GC，原始 JSON 保留关闭前后数据；不能据此证明没有泄漏。
没有比较旧引擎基线、远程网络、复杂编辑器、生产服务、更多数量或多个应用。

## 后续 Pluxel 的破坏性接入点

Workbench 名称保留，但 props 改为 instance/navigation/empty/native；旧 value/layout/view/editor 和 ref
协议、WorkbenchValue/Layout/Handle/View、arrangement/grid 辅助 API、WORKBENCH_PARTS、自研拖放和旧快照被删除。
后续须迁移 `split/view.tsx` 转换、`WorkbenchDocumentRenderer.tsx` 的手动 pathname 分发、Shell 的独立
close/address/grid 控制器。插件身份、远程 renderer、RPC、dirty/save 决策和共享业务服务仍属 Pluxel。

不保留为未迁移 Pluxel 服务的双引擎、旧格式读取器或启动迁移链。实际本地数据需要时做一次性显式转换/重置。
当前分支是内部消费完成；不能据此认定 Pluxel 已兼容或第二应用的通用需求已验证。
