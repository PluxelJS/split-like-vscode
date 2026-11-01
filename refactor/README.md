# Worksplit 架构与维护约束

当前实现使用一个 FlexLayout Model、每文档独立的真实 TanStack Router，以及一个 Worksplit 会话协调实例。
内部 demo、独立打包消费者、Pluxel Shell 的 WorkspaceSession 与 Report Template Studio 均通过公开入口接入。根工作区通过 vendor workspace 包解析 Worksplit；打包消费者独立安装公开制品。历史证据范围、版本和测量限制见 [验收记录](acceptance.md)，本次 API 替换的行为见[本轮实施验收](API_REFINEMENT_VALIDATION.md)；Studio 的业务验收由其项目测试维护。

本页维护当前架构及变更约束，不再并列维护原型推荐行为或已完成的实施计划。
原始设计的演进由 Git 历史及验收记录保存；当前 API 以公开 exports、实现和测试为依据。

| 要解决的问题                           | 权威入口                                         |
| -------------------------------------- | ------------------------------------------------ |
| 安装、初始化、内容与宿主定制           | [公开用法](../README.md)                         |
| 导航、历史、关闭及原生操作的行为边界   | [行为契约](../docs/vscode-workbench-behavior.md) |
| 模块职责与后续修改约束                 | 本页                                             |
| 已验证场景、截图、资源成本与未验证范围 | [验收记录](acceptance.md)                        |
| 资源接入与 API 精进的设计依据          | [精进提案](API_REFINEMENT_PROPOSAL.md)           |

## 单一所有权

| 事实或资源                                               | 所有者                                   | Worksplit 的职责                                                |
| -------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| 布局树、TabSet/TabGroup、Border、尺寸、pin、选择与最大化 | FlexLayout Model                         | 持有唯一 Model，接线 Layout；不镜像布局、不复制移动算法         |
| 路由定义、匹配、location、loader、blocker 和错误页       | 应用的 TanStack route tree / 文档 Router | 每个文档借用同一份定义和独立 memory history；不维护第二套路由表 |
| Tab 会话、Router 寿命、文档身份、预览、MRU 与操作资格    | Worksplit 实例                           | 接纳、激活、关闭、释放；阻止失效操作再次发布                    |
| DOM 与窗口焦点                                           | 浏览器                                   | 观察实际焦点，协调文档目标，不把选中标签当作输入焦点            |
| 浏览器地址与历史                                         | 浏览器，工作台范围内由 Worksplit 协调    | 发布已接受的文档地址，消费和恢复所属历史项                      |
| dirty、编辑修订、保存回执、草稿、共享服务和缓存          | 应用                                     | 读取已登记的事实和决策；不猜测已保存，不建立版本管理框架        |
| 业务 Store、快捷键偏好、外壳、主题和导航                 | 应用                                     | 提供只读会话订阅与命令目标；原生 Store/Hotkeys 和 UI 由宿主组合 |
| 布局快照及其存储                                         | 应用存储                                 | 输出和校验恢复必需数据；快照不是运行时编辑源                    |

同一文档的位置、URL、实例 ID 和去重身份是不同事实：移动和 pin 不改变业务地址；工具移入中央也不会变成文档。
`activeGroupId` 沿用既有 API 名称，表示文档所在的 TabSet 或 Border；标签栏中的 TabGroup 由原生模型管理。

## 原生能力与必要协调

应用直接从 `flexlayout-react` 导入 JSON、Actions、类型、主题和菜单 helpers。
分割、合并、TabGroup 名称/颜色/折叠、pin、Border 尺寸、滚动和最大化均沿用原生机制。
空分区由 FlexLayout 整理；需要保留特定空空间时由应用配置该 TabSet，不建立永久的 left/right/main 区域。

Worksplit 接管的入口只有会话协调需要的部分：Model、内容 factory、Action 提交、文档接纳及 Router/history 寿命。
原生 UI 和程序 Actions 经过同一 dispatcher；可能移除内容的操作进入关闭决策。
单个 native ref、呈现槽、provider 或 renderer 已能表达的需求，不再增加等价 handle、事件总线、插件协议或渲染协议。

原生回调与 `ILayoutApi` 保留上游对象形态。Node 可经 `getModel()` 到达可变 Model，因此这些入口是可信宿主扩展，
不能用 readonly 类型伪称运行时隔离。宿主从原生节点读取呈现信息，通过公开操作提交变更，不直接改写协调拥有的状态。
外部插入回执、Model 替换、批次与停靠策略的具体边界由 [行为契约](../docs/vscode-workbench-behavior.md#coordination-boundary) 维护。

浮动、popout、多窗口、sublayout、Model replacement/undo 和任意组件插入未进入当前文档会话契约。
适用的原生呈现与布局功能自然沿用；无法经公开扩展点协调的能力明确收窄，不 patch 上游或模拟第二个 Model。
FlexLayout 0.11.1 整 TabSet 删除 TabGroup 的兼容处理仅转换为获准的原生叶删除，整理仍由 FlexLayout 完成。

## 路由、操作与焦点

每个路由文档使用应用提供的 Router factory、独立 memory history 和真实 route hooks/Outlet。
应用借出登录态、服务和缓存；Router 的 Wrap/InnerWrap 提供每文档 provider，root route 组织可见内容 chrome。
工具使用普通 React renderer，既不创建 Router，也不参与文档 URL 所有权。

`open` 是跨文档入口，负责最终身份去重；新接纳位置直接使用原生 `target`/`DockLocation`，目标在调用时捕获、接纳时复核。`containerId` 是来源文档的原生容器投影，`preserveFocus` 协调可见旁开而保留来源活动文档/URL/DOM焦点。它们不形成另一套区域或业务布局工作流。文档内 Link/navigate 沿用其 Router 的行为。
原生导航的最终身份冲突保留两个文档实例并报告，不合并或删除实例，也不回滚 Router 已接受的导航。
这是从最初全入口去重目标收敛后的实际边界，避免复制 Router 导航流水线；完整语义见 [文档操作](../README.md#document-operations-and-completion)。

操作的接纳、路由提交、内容绘制和业务保存分别结算。拒绝、被取代、加载失败与已关闭后的清理错误不会互相冒充。
会话有效性和操作资格控制晚到结果；底层工作可能继续，不能称为已取消。
焦点变化撤销抢占前台的资格；导航竞争与关闭按操作资格判定旧结果能否提交。

原生标签选择与键盘操作拥有 DOM 焦点；显式 open/activate 才恢复内容焦点；首次挂载延迟登记时保留可撤销请求。跨组激活同步迁移原生最大化，保证目标可见。
工具、菜单、弹窗与 shell 焦点保留最近活动文档。导航归属是只读投影，不反向触发导航，也不抢工具和树内焦点。
浏览器只有一个 URL；工作台范围内由一个 history 协调器写入，外层应用不能同时提交同一目标。
外层 Router 接入和范围外历史处理仍由实际宿主负责，当前证据不覆盖跨应用路由集成。

## 内容寿命与应用组合

只有需要独立停靠、关闭或恢复的内容才进入 FlexLayout Tab。
普通筛选、业务 Tabs、菜单、弹窗、状态栏和文档内部主从布局使用普通 React 组件；独立 pane 可继续使用 SplitView。
常驻业务导航在 shell 中，全局 Explorer/Inspector 作为稳定工具观察活动文档；页面特有的 pane 随页面组合。
不预建每文档周边工具拓扑、工具停放区或多份可写布局快照。

文档和工具的位置不决定角色。工具标题、尺寸和停靠选项由原生 JSON 拥有，注册只关联 id 与 renderer。
工具注册在实例寿命内固定；移除后的已登记工具可用单次原生 ADD_TAB 重新入树。
动态插件可用性、远程 renderer 撤回与草稿恢复属于应用，当前库没有通用插件生命周期协议。

首次挂载后的内容在切换、移动、pin、最大化与隐藏时保留；原生 render-on-demand 决定未显示内容是否挂载。
原生隐藏不暂停业务任务；React Activity/Suspense 会按原生 effect 规则清理隐藏子区。持续根 owner 保留编辑决策，各 content.effect 在 React cleanup、stop、关闭或实例释放时结算自己拥有的资源，
共享服务不会随单个文档关闭。dirty 和关闭期间编辑变化使用应用已有修订，不由 Worksplit 创建第二套编辑状态。
关闭、失败登记与强制 shutdown 的具体归属见 [内容决策与资源](../README.md#content-decisions-commands-and-resources)。

宿主供应兼容的 React、React DOM、FlexLayout 和 TanStack React Router/Store/Hotkeys peers。
静态命令绑定使用便利配置；动态偏好、输入策略和事件选项直接使用原生 hooks 调用公开命令。
宿主可自行选择 HeroUI 等组件库，不需要遵循 Worksplit 表单或设计系统；完整例子见 [宿主快捷键与 Store](../README.md#host-shortcuts-and-frontend-stores)。

Dock 面向有足够视口空间的桌面工作台。尺寸由 FlexLayout 响应容器，应用或用户明确选择最大化与导航呈现。
Worksplit 没有手机模式、自动最大化策略或桌面布局覆盖层。缩小窗口验收只证明布局、内容和资源保留，不证明手机/触屏可用性。

## 实现入口

| 模块                                                                                      | 职责                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [integration.ts](../packages/react/src/integration.ts)                                    | 唯一协调实例；文档接纳、身份、操作资格、受控 Actions、关闭与资源释放                   |
| [content-effects.ts](../packages/react/src/content-effects.ts)                            | signal/defer、单次结束、固定清理集合及单一错误归属                                     |
| [workbench.tsx](../packages/react/src/workbench.tsx)                                      | 原生 Layout / RouterProvider 接线、内容 context、只读 Store hook、焦点观察与便利快捷键 |
| [native-layout.ts](../packages/react/src/native-layout.ts)                                | 原生节点和 Actions 遍历；不实现布局算法                                                |
| [layout-policy.ts](../packages/react/src/layout-policy.ts)                                | 可配置中央拓扑限制；原生临时候选统一校验拖拽与 Action，不触发内容保存                  |
| [document-history.ts](../packages/react/src/document-history.ts)                          | 观察公开 memory-history blocker 决策，结算 Worksplit 导航回执                          |
| [browser-history.ts](../packages/react/src/browser-history.ts)                            | 所属浏览器历史项的提交、遍历与拒绝恢复                                                 |
| [core](../packages/core/src/index.ts) / [SplitView](../packages/react/src/split-view.tsx) | 独立 pane 尺寸与分隔条，未成为 Workbench 的第二个 docking 引擎                         |

内部模块分工不要求增加公共控制器或新包。只在有独立不变量、实际消费阻碍或明确资源寿命时增加公共能力。
真实消费入口是 [demo](../packages/demo/src/main.tsx) 与 [独立安装 fixture](../scripts/fixtures/packed-consumer/app.tsx)，均通过公开包入口使用库的协调。

## 后续修改与应用迁移

Pluxel Shell 与 Studio 的接入共同遵循以下边界：

- 项目/工作台会话由宿主持有，React shell 借用；组件 effect 重放不创建或释放整套业务实例。文档 route tree、项目业务操作和 UI 外壳按所有权组织，不按文件行数机械拆分。
- 工具显隐、分组展开和焦点使用现有 `activate`；移动和重新插入仍提交原生 Actions。旁开文档在 `open` 时给出原生位置，避免先接纳再移动而撤销自己的焦点请求。
- 批量关闭使用纯删除的原生 Action group。关闭拒绝保留整个批次；文件写入与关闭不组成跨系统事务，宿主明确报告已完成阶段及恢复失败。
- 多视图共享草稿、输入和编译产物由业务资源所有者维护。视图释放使用权，明确的业务操作才丢弃共享修改；晚到编译结果必须复核实际资源代次。
- 制品接入校验同一份 React、Router、Store、FlexLayout 和 core 的解析身份及 peer 范围；源码测试通过不能替代独立安装制品的类型、构建和浏览器检查。

Studio 是 Electron 应用，其项目级关闭与文件操作证据不替代 Pluxel Shell 外层 Router、浏览器历史和插件撤回的验收。分别验证实际宿主边界，不增加通用 adapter、快照迁移器或插件协议。

修改前核对 exports、上游锁定版本、实现、调用方和相应测试；正常原生操作不能因包装新增另一套语义。可选 layoutPolicy 在短寿命原生候选上执行 Action 验证结构上限，不保留第二个 Model，也不自写 tidy。
受保护身份、dirty 与资源移除路径必须在 UI、程序 Actions 和恢复入口保持同一约束。
遇到上游缺口，先以源码和最小复现确定范围，再同步行为、用法和回归；不为维持原推荐而复制流水线。

资源成本应记录真实请求、提交渲染、业务/history 订阅和关闭清理，说明样本、环境与 GC 限制。
不因行数更少、隐藏内容未显示或单次采样更快就宣称高效；新的公共能力需从安装后的公开入口验证。

旧 Workbench descriptors、arrangement/grid、自研拖放和旧快照兼容链已移除，独立 SplitView 保留。
Pluxel 使用 Worksplit 协调文档与工具；插件身份、RPC、远程内容、共享草稿、修订与保存策略仍属 Pluxel。内容资源使用 content.effect，不能保留另一套通用资源登记层。
破坏性接入点由 [迁移说明](../docs/vscode-workbench-behavior.md#breaking-contracts-and-host-migration) 维护。
内部消费与独立 fixture 的结果不替代 Shell 或 Studio 的实际业务与在线验收；历史记录也不证明今天的制品已加载。
