# Worksplit 内部重构验收

验收日期：2026-10-11（补齐原生能力、空区整理、删除强制窄屏控制器，并补齐 demo 右侧 Border 后的完整复验）。范围是 Worksplit 库与自有 demo；Pluxel、第二应用及跨应用兼容性没有接入或验收。

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
调用方直接从 `flexlayout-react` 导入 Actions、DockLocation、JSON 类型和菜单 helper。
TabGroup 名称、颜色、折叠、成员与整组移动，pin、TabSet/Border 尺寸、分区、最大化和常规呈现属性
均由原生 Model/Actions 管理。Worksplit 只协调文档身份、URL、焦点和移除生命周期；没有等价布局 API。
React binding 的 `native` 选项直接沿用上游 `ILayoutProps`，仅排除集成拥有的入口和不支持的多窗口入口。
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
| Node（pnpm 脚本）/ pnpm                        | 24.21.0 / 11.8.0              |

版本核对来自安装后的 package 信息及 `pnpm-lock.yaml`；公开 dist JS smoke 另用 shell Node 24.16.0。Router 和 FlexLayout 为 peer，demo 显式消费相同实例。
Store、Hotkeys 在库中使用；Hotkeys、Store 和 Model 没有另造事件总线、路由表或布局树。
`packages/demo` 只导入公开包入口；Vite 与 TypeScript 的私有源码 alias 已删除。
生产 build 使用默认 dist exports，开发服务使用公开的 development condition。

被替代的 editor arrangement/grid、旧 Workbench model/editing/drag 实现和测试已删除；
独立 SplitView、Pane、core pane sizing 及其原有测试保留。
[发行说明](../.tegami/flexlayout-tanstack.md) 标明 core/react 的 major bump；未手改版本或 publish-lock。
空分区修复的 React patch 另见 [发行说明](../.tegami/fix-empty-tabsets.md)。
本轮原生交互与默认值修正见 [发行说明](../.tegami/preserve-native-interactions.md)。
删除强制窄屏呈现及桌面偏好覆盖层见 [发行说明](../.tegami/remove-forced-compact-layout.md)。

## 检查结果

| 检查                                    | 结果                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm lint`                             | 通过，0 warning / 0 error                                                                              |
| `pnpm typecheck`                        | core、react、demo、工具配置及新增浏览器 TypeScript 通过；类型化导航的错误调用断言通过                  |
| `pnpm test`                             | 104 项通过：core 5、SplitView 18、文档协调 9、多 Router 1、原生能力与生命周期 67、原生 React 交互 4    |
| `pnpm build`                            | 三个包通过；生产 demo 从公开 dist 入口打包                                                             |
| `pnpm source-declarations:check`        | 通过，构建未在源码中遗留声明文件                                                                       |
| `pnpm format:check`、`git diff --check` | 通过                                                                                                   |
| `pnpm test:browser`                     | 42 项 Chromium 测试通过，0 skipped / unexpected / flaky                                                |
| 公开 dist JS smoke                      | 从 demo 包解析 `@worksplit/react`，双文档、原生分组、实际最大化快照/恢复、受控整分区关闭、dispose 通过 |
| 删除符号与本地 Markdown 链接检查        | 通过；旧符号仅在迁移说明或设计语义中出现                                                               |

可见但未隐藏的提示：tsdown 提示 TypeScript 7 API 尚属 experimental；生产 demo 单个 JS chunk 为
577.25 kB（gzip 170.11 kB），超过 Vite 默认 500 kB 提示阈值；多 Router 的 jsdom 检查提示未实现
scrollTo。真实浏览器另外验证了滚动保留。未通过调高阈值或吞掉错误来消除提示。

原型先完成共享真实 route tree、两个并排文档、一个工具、类型推导和 dirty/redirect/history/race 门槛，
再删除旧引擎并扩大验收。原生能力复核补齐整组与批量关闭、跨空间批次选择和真实菜单；本轮又补齐
真实键盘选择、Border 工具/文档 URL、单文档/整组移动选择、原生滚动开关与右侧 Details 工具。
保留最后完整 42 项浏览器结果文件（原生能力 21、文档协调 21），全部测试在同一次完整执行中通过。

## 浏览器交互证据

测试：[workbench.spec.mjs](../packages/demo/tests/workbench.spec.mjs)、
[native-layout.spec.ts](../packages/demo/tests/native-layout.spec.ts)。
完整结果：[browser-results.json](acceptance/browser-results.json)。
截图：[桌面 1440×900](acceptance/desktop.png)、[缩小窗口 390×844](acceptance/narrow.png)。
原生分组截图：[桌面 1440×900](acceptance/native-groups-desktop.png)、
[缩小窗口 390×844](acceptance/native-groups-narrow.png)。截图来自实际测试过程，并经过目视复核。
右侧原生 Border：[展开与真实尺寸拖动后的桌面](acceptance/right-border-desktop.png)、
[缩小窗口中明确展开工具](acceptance/narrow-right-border.png)。
390×844 是窗口缩放回归条件，不是手机或触屏停靠兼容声明。
拖动分屏问题：[修复前](acceptance/split-empty-before.png)、
[修复后桌面](acceptance/split-empty-after-desktop.png)、
[修复后窄屏](acceptance/split-empty-after-narrow.png)。

| 场景                       | 观察与断言                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 两个真实文档、嵌套路由     | 独立 params/search/loader/context、原生 hooks 与 Outlet；A 编辑不改变 B                                                                                                          |
| 类型化入口和导航投影       | open 使用实际 route tree；metadata 归属与已提交文档更新，工具不触发反向导航                                                                                                      |
| dirty 拒绝与 open redirect | 拒绝保留原地址和输入；redirect 到已打开 B 复用 B，dirty A 原样保留                                                                                                               |
| 原生 Router blocker        | Worksplit receipt 明确 router-blocked，已提交 location 保留                                                                                                                      |
| 连续后退与前进             | 两个待决确认拒绝后回到接受项，history.length 和 forward 栈保留；待决期间 open 明确 history-busy                                                                                  |
| 慢结果与焦点竞争           | 聚焦 B 或工具撤销抢焦点资格；原生快导航与后来的 open 取代慢结果                                                                                                                  |
| 关闭期间编辑/导航          | 重复关闭只出现一份决策；新编辑由应用修订检查拒绝；新 route 内容使旧关闭批准失效                                                                                                  |
| 关闭后的晚到结果           | 不复活节点或写回 URL；最后一个文档关闭后保留空目录、工具和空焦点记录                                                                                                             |
| 原生移动与隐藏             | 跨组、Border、pin、最大化、隐藏后输入、scrollTop=480、挂载和业务订阅数保留                                                                                                       |
| 原生 TabGroup 与菜单       | 右键菜单创建、命名、颜色、加入、移出、折叠、解组；原生组拖放到另一分区与 Border 后保持相同 DOM、输入、scrollTop=420 与资源                                                       |
| 原生批量及整分区关闭       | close others/right 走同一决策；折叠组成员也参与整分区关闭；一个拒绝不移除任何成员；非 closeable 直接子组整体保留                                                                 |
| 先批准成员后继续编辑       | A 批准、B 待决期间真实编辑可见 A，已有编辑修订变化使整批返回 changed；两个文档、输入及订阅仍在                                                                                   |
| 关闭中布局及内容变化       | 待决时添加成员或提交新 route 内容，使旧整分区批准失效；允许继续操作，不锁死内容                                                                                                  |
| 真实鼠标拖放               | 使用原生 drag 事件流将 A 移到 B 组；保留输入与活动组                                                                                                                             |
| 连续边缘拆分与合并         | 标签及整组 RIGHT/LEFT/RIGHT 真实拖动后始终只有两个非空 TabSet、A/B 可见；合并删除空来源，关闭最后内容只留一个空 root，再打开正常                                                 |
| 全局工具                   | 工具隐藏与中央停靠保留输入，不接管文档 URL；Portal 命令保留 inspector 上下文                                                                                                     |
| 右侧原生 Border            | Details 标签展开/收起；真实鼠标拖动分隔条，原生 size 与实际宽度从 260→356 px；工具输入焦点不抢 URL，A/B 切换更新 marker；快照刷新恢复 356/selected=0，工具草稿不持久化           |
| 右侧工具移动与小窗口       | Details 移入中央后空 right strip 原生 auto-hide；移回右侧保持原生收起，再点击标签展开；同一 DOM、输入与文档资源保留；390×844 resize 不改原生 JSON/snapshot，工具切换保持文档 URL |
| Border 选择与移动          | A 在 Border、中央仍选 B 时，工具切换/收起保留 A 的 URL；单 A 移入展开 Border 仍选中时保持 A；整组移入遵循原生保留 Inspector 选择，再真实点击 A 显示原内容                        |
| 原生键盘焦点               | 未选 tab 的 Enter 选择后仍聚焦标签按钮，Arrow 可继续移动；已选 tab 再 Enter 由原生聚焦内容首 link；显式 open/activate 恢复输入焦点                                               |
| 原生滚动容器               | 普通长路由页面无业务 overflow 容器，真实 wheel 滚动 native tab；enableScrollbars false/true 直接切换 hidden/auto 与可滚动行为                                                    |
| 命令                       | Ctrl+S 只保存活动文档；工具输入焦点下仍正确指向文档，未广播保存                                                                                                                  |
| 原生 redirect 身份冲突     | 明确报告 native-identity-conflict，两个实例继续存活，没有静默合并/关闭                                                                                                           |
| 错误隔离                   | loader 和 renderer 失败只影响各自实例，另一可见文档继续工作                                                                                                                      |
| 可选快照                   | 刷新以地址栏激活，拒绝不兼容数据并提供明确 reset；恢复关闭后不复用旧 history hint                                                                                                |
| 缩小窗口与明确最大化       | resize 前后原生 JSON/snapshot 相同、无文档下拉框；真实 Restore/Maximize 控件保留 draft 与挂载，手动选择经存储、刷新、拓宽后保持                                                  |
| 缩小窗口同文档拆分         | 活动 ID 不变时，原生组移到 RIGHT 新 TabSet 后维持两个可见分区、不自动最大化；保持相同 DOM、输入、scrollTop=360 与资源                                                            |
| 缩小窗口多操作最终选择     | A/C 同组 active A、B 另组；GROUP 将 A 移到 B 组再选择原组，最终 C 拥有 URL 和原生最终选择；布局不被窄屏策略改写，A 的输入、DOM、Router 及资源保留                                |
| 销毁                       | 业务订阅与 document history subscriptions 归零；整个实例 dispose 后存活 Router 归零                                                                                              |

纯策略的 admission、程序单 tab/整组移动、完整组聚合恢复策略、快照拒绝、跨空间批次最终选择，以及
原生观察者抛错后的资源收尾和关闭工具的迟到登记拒绝在单元测试中验证；原生 preview 连接同一策略的
接入点经源码核对。实际鼠标拖放由浏览器验收覆盖。窗口失焦/恢复场景使用真实页面的事件观察器，
但事件由测试注入；没有验证操作系统层面的应用切换。触屏手势、其他浏览器及 React 18 未验收。

## 根据上游证据收窄的语义

1. **最终 redirect 去重只保证 open。** 原生 Router load 提交匹配后才通知 resolved，无法在普通
   Link/navigate 的该通知中保证提交前去重与保留旧内容。原生入口冲突明确报告并保留两个实例。
   没有复制 Router 导航流水线或手写路由分发。
2. **拒绝回执来自公开 memory history blocker 观察。** 当前上游原生 navigate Promise 在拒绝时
   可能悬挂；Worksplit 为自己的 receipt 观察 blocker 结果，不改上游内部。原生调用方仍遵循上游行为。
3. **保留原生布局能力，约束文档所有权。** 原生分组、常规属性和纯布局批次已支持；整分区及纯关闭批次
   经过同一决策。身份、文档 component/config、任意插入、Model 替换/undo、floating/popout/sublayout
   仍拒绝。混合关闭/布局批次也拒绝，避免布局先变化而关闭又被拒绝。
4. **历史限定于 owned scope。** 使用 indexed state 和原生 history.go 回滚；待决遍历期间新 open
   返回 history-busy。外部历史项报告 history-outside-scope，宿主必须处理退出/卸载。
5. **原生呈现槽属于可信扩展。** 上游 Node.getModel 可达可变 Model，不能用 readonly 假称隔离。
   普通内容只取得窄能力；可信槽不得绕过协调改 Model。
6. **窗口呈现策略归应用。** 本轮删除此前低于 640px 自动最大化的控制器、文档切换器和桌面偏好覆盖层。
   原生 Layout 自己观察尺寸；缩小或拓宽窗口保持实际布局和最大化选择，snapshot 直接保存原生状态。
   应用与用户可用原生 Actions/控件明确最大化；demo 的导航折叠 CSS 归 demo，不强制手机或触屏停靠兼容。
7. **整分区关闭只做必要适配。** 锁定的 FlexLayout 0.11.1 会对 TabGroup 调用不存在的 `delete()`。
   批准后用原生 Actions 删除可关闭直接子项的叶子，再发 `deleteTabset`；分区整理、空组与 root placeholder
   仍由 FlexLayout 完成。含非 closeable 成员的直接 TabGroup 整体保留，遵循原生 TabSet close 的筛选语义。
8. **不模拟策略批次。** native GROUP 不对每一步调用公开 action veto，且程序移动不调用 preview hook。
   带 `allowDrop` 时，多步移动/分组批次明确拒绝；逐条操作、初始树和恢复则校验实际原生节点及成员。
   不使用第二个 Model 来预测或复制上游算法。无此策略时纯原生布局批次自然支持。
9. **跨空间批次按最终中央选择协调 URL。** 原生 GROUP 改变中央选择或显式选择中央文档/active TabSet 后，
   读取最终中央 selected document；仅选择 Border/工具、中央未变化的批次保持最后文档。
   单条 `SELECT_TAB` 可明确激活 Border 文档，工具不接管 URL。不猜测多个空间的中间操作意图。
   该最终投影规则用于多操作批次；只有一个叶 Action（含嵌套）的 GROUP 与该单操作选择/移动语义一致，
   原生执行和 observer 仍接收原批次。singleton 不需要复制流水线或额外存储就能保持原生含义。
10. **批次关闭复核应用既有编辑修订。** dirty 的多内容关闭需要 `getCloseRevision`；缺失时在决策前返回
    `revision-required`。全部决策完成后复核 token，覆盖早期批准成员后来再次编辑。Worksplit 不生成或管理版本。
11. **空区整理和分区身份遵循原生行为。** 库及 demo 原先全局设置 `tabSetEnableDeleteWhenEmpty: false`，
    导致每次搬空来源仍显示 “Your workspace”。移除该覆盖后，FlexLayout 自动删除空来源，并在最后 root
    为空时生成唯一 placeholder。demo 用真实 `Actions.moveNode` 打开并排 B，后续移动读取当前 native ID，
    不保留固定 `left/right/main`。FlexLayout 0.11.1 的 `fromJson` 会在首次 Action 前将已整理掉的空节点留在
    idMap；文档 admission 因而核对原生 live tree，失效目标返回 failed 并释放候选 Router，而不是报告成功。
    没有复制 tidy、patch 上游或维护另一套分区。
12. **让原生选择拥有焦点及移动语义。** Native SELECT/active TabSet 只同步文档和 URL，不调用内容 focus；
    显式 open/activate 才恢复业务登记的焦点，排队回调复核现有 focusEpoch，工具选择、收起和真实 focus 可撤销它。
    单个活动文档移动且仍 natively selected 时保持文档所有者。FlexLayout 0.11.1 Border.drop 对整组移动调用
    restoreSelectionAfterInsert，保留原有 Inspector 选择；本集成没有强制展开被移动成员来伪装保留选择。
13. **原生默认值、滚动与错误恢复不另包一层。** 缺省 children、上下文类型、tab type、文档自动 ID 和
    undefined 属性重置已验证；明确 null 类型、数组节点、非法 children/ID 仍拒绝。Tab 是叶节点，显式
    Tab.children 也拒绝，避免上游忽略其中内容而静默丢记录。上游 Action 的可选 TS
    字段在 exactOptionalPropertyTypes 下不接纳显式 undefined，测试仅为运行时重置做类型断言，库不复制这些类型。
    删除内容 overflow:hidden 和重复错误边界后，滚动由原生管理，tool renderer 可直接用原生 Retry 恢复；
    React 回归验证 sibling 文档保持同一 DOM、draft 和 Router。路由错误仍由 TanStack 隔离。
14. **保留原生尺寸更新路径。** Workbench binding 不再订阅整个 catalogue revision，也不增加响应式 ResizeObserver。
    同一双 TabSet 快照、同一 adjusting=true 权重 Action 的 React 回归中，Worksplit 与裸 Layout 的
    onRenderTabSet 额外调用数都为 0，布局 JSON 相同；这只验证该上游命令路径，不是整应用 FPS/CPU 基准。
    390px 下的 React 对照验证未插入切换器、未自动提交 MAXIMIZE，观察者数量与裸 Layout 一致。
    native GROUP 将 A 移到 B 分区后又选择原分区 C，最终选择保持原生结果，不再由宽度控制器改写。

这些取舍已同步到用法、行为契约、设计状态、测试及 demo。pending loader 可能继续；会话/操作检查
只保证晚到结果不获准提交给已关闭实例，不宣称实现了真正取消。

连续桌面 edge split 的生产 CSS 下，A 宽度从 572→449→397 px，Chromium 的默认 scroll anchoring
会随段落换行将 scrollTop 从 420 调整到 746，以保留阅读锚点；DOM、输入、会话和订阅没有重建。
新增 edge 回归仅在测试中设置 `overflow-anchor: none`，隔离宽度重排后断言 scrollTop=420。
既有整组/Border 和缩小窗口保留测试仍使用真实样式；不承诺任意 resize 后像素 scrollTop 恒定。
手动最大化 B 后，A 的原生祖先是 display:none，仍连接的隐藏节点没有可用布局几何，scrollTop、
scrollHeight、clientHeight 读取为 0；拓宽并 Restore 后，同一 A DOM 回到 scrollTop=460，输入、
挂载与业务订阅保留。因此隐藏保留断言比较隐藏前与恢复可见后的状态，不以隐藏时几何读数判断丢失。
显式应用配置和已保存快照中的保留空区设置仍按原生契约生效，不暗中改写；旧 demo 快照可取消
“Restore on refresh” 后刷新以使用新默认配置。

## 文档数量与资源成本

脚本：[measure-workbench.mjs](../scripts/measure-workbench.mjs)；原始结果：
[measurements.json](acceptance/measurements.json)。最后一轮测量使用实际 Chromium、Vite development、本地 HTTP，
暖服务器/模块缓存与独立冷浏览器上下文。Linux x64，Intel i5-11400H @ 2.70 GHz，Node 24.21.0。

1440×900、两个可见组、零注入网络延迟、staleTime Infinity；每个新文档先显示，再进行下一次打开。
20 次切换，每次 open/switch 等待两个 RAF；随后 resize 到 1280×800，最后逐个 await close。
右侧 Details 保持默认收起，未展开该工具；此测量没有覆盖其 React/Store 成本。底部 Inspector 保持挂载，
其提交渲染也不计入文档业务渲染计数。
追加打开时间排除第一个启动文档，包含之后 N−1 个文档及绘制等待；计数包含第一个文档。
第一个追加文档通过原生 RIGHT split 建立第二个 TabSet，后续根据种子文档读取当前原生容器。
公开 `getLayout()` 克隆与定位的累计时间包含在追加打开耗时内，2/10/50 文档分别为 0.0/1.5/10.8 ms。

| 文档数 | HTTP/loader | 提交渲染 | 切换额外渲染 | 业务 / history 订阅 | 追加打开 ms | 20 次切换 ms | close 回执 / 含绘制 ms |
| ------ | ----------- | -------- | ------------ | ------------------- | ----------- | ------------ | ---------------------- |
| 2      | 2           | 2        | 0            | 2 / 2               | 81.0        | 666.6        | 15.0 / 17.6            |
| 10     | 10          | 10       | 0            | 10 / 10             | 349.3       | 666.5        | 72.9 / 77.6            |
| 50     | 50          | 50       | 0            | 50 / 50             | 1847.3      | 733.2        | 511.2 / 551.2          |

三个数量下，切换和 resize 均未新增文档 loader、提交渲染或挂载；关闭后业务/history 订阅归零，
卸载数等于文档数，close cleanupErrors 全部为零。关闭文档后仍有一个无 loader/订阅的 URL builder
Router，属于实例寿命；实例 dispose 的浏览器测试验证它也被释放。

这些是一次最终采样，不是生产环境吞吐、峰值内存、P95 或性能优秀的证明。切换时间包含 RAF 等待，
不是纯 CPU 时间；渲染计数是业务组件提交 effect，不覆盖 speculative render 或全部 shell 渲染。
订阅计数覆盖 demo 业务服务与公开 history.subscribers，不穷举 Router/React Store 内部订阅。
单文档一个 Router 的资源与关闭成本随数量增长；50 个文档的逐个关闭回执约 511.2 ms。
本轮补齐右侧 Border 后重新采样，不把单样本差异归因为某段代码的性能收益。

追加原生工作负载：`pnpm measure:native`，脚本
[measure-native-layout.mjs](../scripts/measure-native-layout.mjs)，原始结果
[native-measurements.json](acceptance/native-measurements.json)。在基线测量后顺序执行，没有同时运行另一个
浏览器套件或测量进程。相同环境下，每个文档先显示，再用原生 GROUP 为两个 TabSet 各建一个组并加入
其余标签；20 次双组折叠/展开共 40 批、80 个属性操作；两个组各 CENTER 移到另一分区，再 LEFT/RIGHT
拆出新分区，共 4 次移动，空来源由原生清理；
20 次轮流激活；最后一个纯关闭 GROUP 删除两个 TabSet，再独立 dispose。每阶段等待两个 RAF。
分组时间包含公开 `getLayout()` 克隆与定位自动组 ID 的查询成本（2/10/50 文档分别 0.3/0.3/0.4 ms）。
移动时查询当前容器的累计时间为 0.7/0.5/1.4 ms；关闭前定位两个实际 TabSet 为 0.2/0.3/0.3 ms。
查询计入对应含绘制阶段总时间，关闭回执单独从 dispatch 开始计时。这次工作负载随空区清理调整，
不与保留固定空分区的旧样本作直接速度对比。

| 文档数 | 分组含绘制 ms | 40 批折叠/展开回执 / 含绘制 ms | 4 次组移动含绘制 ms | 20 次激活含绘制 ms | 整批关闭回执 / 含绘制 ms |
| ------ | ------------- | ------------------------------ | ------------------- | ------------------ | ------------------------ |
| 2      | 33.4          | 360.9 / 1333.2                 | 133.3               | 666.8              | 10.6 / 28.3              |
| 10     | 49.7          | 520.1 / 1350.0                 | 133.4               | 666.7              | 10.4 / 29.1              |
| 50     | 99.0          | 850.4 / 1499.1                 | 135.1               | 781.6              | 20.0 / 29.2              |

这些原生阶段三个数量下都没有新增 loader、业务提交渲染、挂载或业务/history 订阅。批量关闭后订阅归零、
卸载数等于文档数，cleanupErrors 为零；dispose 后存活 Router 归零。所有内容都是 clean，没有确认等待，
仍挂载的 Inspector 与 host React root 由随后关闭浏览器 context 结束。整批和逐个关闭属于不同工作负载，
不能用这次单样本直接推导生产环境加速比。折叠/切换含固定 RAF 等待，折叠批次回执成本也随文档数量增长；
这不穷举全部 shell/原生组件渲染。独立回执及每阶段计数在 JSON 中。
MRU 候选查找改为局部 Map 与首次命中返回，避免此前全数组嵌套扫描；这是源码复杂度改进，没有单独 CPU 基准。

堆读数来自 CDP Performance，无强制 GC，原始 JSON 保留关闭前后数据；不能据此证明没有泄漏。
没有比较旧引擎基线、远程网络、复杂编辑器、生产服务、更多数量或多个应用。

## 后续 Pluxel 的破坏性接入点

Workbench 名称保留，但 props 改为 instance/navigation/empty/native；旧 value/layout/view/editor 和 ref
协议、WorkbenchValue/Layout/Handle/View、arrangement/grid 辅助 API、WORKBENCH_PARTS、自研拖放和旧快照被删除。
后续须迁移 `split/view.tsx` 转换、`WorkbenchDocumentRenderer.tsx` 的手动 pathname 分发、Shell 的独立
close/address/grid 控制器。插件身份、远程 renderer、RPC、dirty/save 决策和共享业务服务仍属 Pluxel。

不保留为未迁移 Pluxel 服务的双引擎、旧格式读取器或启动迁移链。实际本地数据需要时做一次性显式转换/重置。
当前分支是内部消费完成；不能据此认定 Pluxel 已兼容或第二应用的通用需求已验证。
