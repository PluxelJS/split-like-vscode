# Worksplit 重构收敛与剩余工作

2026-11-05：新 API、唯一原生 Model、内容 owner、原生导航修正与共享公开实例已经进入代码。
已实施契约只在 [README](../../README.md)、[架构](../architecture.md)、[行为](../vscode-workbench-behavior.md)、
[资源](../resource-lifetimes.md)及[原生支持](../navigation-support.md)维护；这里不再保留一份完整 API 草案。
库、demo、独立制品的验收与实际财务宿主迁移分别记录；财务宿主仍待新 API 迁移和验收。
当前执行结果与缺口统一见[迁移状态](README.md)，不同消费者的证据不能相互替代。

## 保留的决策与证据时点

2026-11-03 下游要求统一重构并破坏性替换旧 API；11 月 4 日明确要求常用打开、旁开、菜单、焦点和资源协调由库完成，
业务保存、阅读层级、2×2 和尺寸政策由宿主拥有。设计基线为 Worksplit `4b0cfa7`/`4a68a89`；
财务场景原基线 `0ce93ea4`、当时复核 `39721c93`。这些日期和提交描述当时观察，不冒充本轮运行结果。
完整设计演进和旧 API 通过 Git 追溯，[场景预演](worksplit-redesign-scenarios.md)保留决定架构的用户旅程。

本轮保留以下取舍：

- 一个实际 native Model、一份 native history/Router 对应一个文档、一个 content record 拥有其寿命；短期接纳候选不成为第二布局树。
- 原生类型、Actions、props/ref 和菜单条目可直接消费。重复通用接线由库完成，业务不需要再写逐文档批准循环。
- 编辑批准绑定内容实例、owner 和实际保存依据，不能从 URL、dirty 布尔值或最后一个 Promise 推断。
- 不保留旧入口别名、兼容重载、旧快照转换器、第二批准路径、通用命令/插件平台；有价值的算法和保护回归迁入当前实现。
- 查询不能触发 Model 保存副作用。真实全局属性查询缺口、重载 redirect、最终提交复核、拒绝结算与原生拖拽反例，
  连同最小公开修正、精确版本、独立安装及移除条件，统一归 [native support](../navigation-support.md)。

## 剩余范围与证据边界

- 父仓库聚合验收与财务未运行项由其 `VALIDATION.md` 维护；本仓库、独立制品和实际宿主的结果不能相互替代。
- 最终源码的两组测量已先通过行为检查，再记录相同工作量与完整清理。它们是当前环境单次样本，无等价历史基线，不宣称性能提升。
- 外部 Pluxel Shell/Studio 尚未完成迁移。Shell 的 document/session/nativeMenus，Studio 的 editor-lifecycle/panes
  仍须按实际 checkout 迁移 controller、保存依据、菜单与历史接管；历史迁移文档不证明它们已安装新制品。
- 先提交并推送已验证的子模块，再更新父仓库 gitlink，完成父仓库验收后提交并推送集成改动。

下面的矩阵保留反例与完整验收边界；执行入口和串行顺序见[交付检查](worksplit-redesign-implementation.md)。

## 行为验收矩阵

以下保留决定本次重构边界的验收要求；它不是一份全绿结果表。执行状态以本轮验收报告为准。相同不变量复用现有测试；只有真实边界缺口才增加测试，
不要用 mock 返回自己定义的结果来证明 native/Router 集成成立。每项证据记录源码提交、依赖版本、运行入口和未覆盖范围。

### 公开 API 与接纳

| 编号 | 场景                                                           | 必须观察到的结果                                                                                                        |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A01  | 原生 route params/search/relative from/basepath 泛型           | 正确目标保留推导；错误参数产生预期类型错误；没有 any 兜底                                                               |
| A02  | 引用旧 hook、命令入口、旧 placement 选项、旧 SplitView 导出    | 明确编译失败；无 alias、shim、legacy 分支；旁开意图由新 destination 组合保留                                            |
| A03  | 最小只读工作台首次 open                                        | 无 controller/Hotkeys/自写菜单也能运行，空布局正确接纳                                                                  |
| A04  | loader 重定向与规范 search                                     | 以最终原生 URL/metadata 确定身份，候选放置不重复 loader                                                                 |
| A05  | reuse preserve/navigate/new 与 duplicate                       | 不移动复用项；导航受 guard；复制已提交 URL、独立 Router、无复制草稿                                                     |
| A06  | 原生文档 navigate 到另一个已打开身份                           | 两个实例正常保留，无冲突 issue、偷关页或第二导航流水线                                                                  |
| A07  | reveal/background 与同容器、隐藏 Border、最大化冲突            | 符合呈现表；不静默偷焦点，不允许 background preview                                                                     |
| A08  | 未限定窗格、固定右侧、财务 2×2 三个宿主                        | 前者能超过四窗格；后两者遵循各自策略，内核无业务数字分支                                                                |
| A09  | 同一异步 open 期间源/目标移动、关闭、ID 重用或策略改变         | 最终复核生效；晚到操作不插入错误位置或新实例                                                                            |
| A10  | 点击/拖拽、取消、重复拖拽、卸载 Layout                         | 统一接纳，显式 drop 位置优先，无残留 overlay/全局 drag 状态                                                             |
| A11  | workspace/container 两种预览作用域及跨容器拖动                 | 可替换资格符合规则；不能隐式删除目标容器的另一预览                                                                      |
| A12  | 新预览加载/接纳失败、旧预览有草稿/待确认写入                   | 失败保留旧预览；成功接纳后拒绝替换则旧页转普通，资源保持                                                                |
| A13  | 拖放到标签条中间、折叠/展开的 TabGroup，期间目标重排           | 保留原生 index/组目标；异步位置失效明确拒绝，不改为容器末尾                                                             |
| A14  | 首层旁开→同标签下探→push 筛选/replace 口径→逐层返回            | content/Router 保持，返回正确来源条件；已有完整地址则按应用政策复用，无额外阅读栈                                       |
| A15  | 全查询身份、多副本、documentKey 嵌套与“当前报告”入口           | 最近显式 key 声明和 routeId 命名空间正确；恢复可重建；选定具体实例用 activate，不再次按 key 换副本                      |
| A16  | beside 的空态、同方向候选、新分屏、上限与来源失效              | 初始空态无需宿主分支；按原生顺序选合法候选；无方向外回退；失效不冒充初始空态；复用/drop 不运行 resolver                 |
| A17  | 点击/程序 link.open/drop 的默认或自定义结果反馈                | 一个执行一次回执；拖拽取消不解析目标；onResult 不重复报告/执行；延迟目标不伪造 href                                     |
| A18  | 静态 preserve/navigate 命中、未命中与 redirect 晚命中          | 已初始化早命中不加载；懒恢复原实例按保留 URL 初始化一次；真实 blocker 单独决定，新建接纳候选 Router，晚命中成本如实记录 |
| A19  | 两个独立普通打开、同预览槽竞争、焦点已移走                     | 普通结果能合法后台接纳且报告实际 presentation；无法后台接纳时不改目的地；预览只在自身作用域取代                         |
| A20  | loader error/not-found、单内容 render 错误、接纳基础设施失败   | 原生错误页保留为文档，其他内容可用；只有协调失败返回 failed，库不重试业务写入                                           |
| A21  | open/createLink 的外部目标、reloadDocument、显式 ignoreBlocker | 在副作用前明确拒绝不支持的文档目标/选项；外部页面跳转经工作台退出，不以原生参数绕开共享保护                             |

### 决定、保存与资源

| 编号 | 场景                                                                   | 必须观察到的结果                                                                                     |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| L01  | hasUnsavedChanges=false，decide 拒绝 pending write                     | 单关、批量、导航、预览替换和退出均不跳过该决定                                                       |
| L02  | 两内容：第一个 allow，第二个 deny                                      | 无任何标签提前删除、无资源提前停止；已成功应用保存不回滚                                             |
| L03  | 确认期间 t7→t8，或 t7→t8→逻辑相同内容                                  | 旧批准失效；token 不能因状态外观相同而复活                                                           |
| L04  | 保存并关闭成功产生新 token，期间正常 rerender                          | 对实际保存成功 token 的批准可以提交；普通回调更新不换 owner，不因相对初始 token 改变一概拒绝         |
| L05  | 保存期间新增编辑、回执未知或保存失败                                   | 新编辑和内容保留；不把最新 token 当被保存证据                                                        |
| L06  | 确认期间 controller 更换、owner 完整暂停、同 ID 重开                   | 旧批准无效；保护不可用时拒绝，不能视为干净                                                           |
| L07  | React StrictMode、Suspense、丢弃的 concurrent render                   | 只用已 commit owner，资源按真实寿命持有；隐藏不解除保护                                              |
| L08  | 多个 useContent、重复 controller、多个 runEffect                       | 读者不占 owner；双 owner 报错；独立 effect 正常清理                                                  |
| L09  | 工具 save/focus/leave 与文档同能力                                     | 声明能力一致执行；缺能力明确返回，不 silently ignore                                                 |
| L10  | 相同关闭重复、相交范围、决定取消、回调重入                             | 同请求合并，重叠 busy，signal 有效，无重复弹窗/释放或等待环                                          |
| L11  | 已批准关闭、其中清理失败                                               | 原生关闭保持，其他清理继续；错误按固定集合返回一次                                                   |
| L12  | 关闭后异步资源到达，另有同 ID 新实例                                   | 晚到资源立即释放，不附着新实例；晚到错误只通知一次                                                   |
| L13  | 共享草稿/服务被多个文档借用                                            | 关闭只释放当前引用，其他内容与业务事实不受库擅自处置                                                 |
| L14  | closeWorkspace 包含 pinned/不可关工具、workspaceLeave 拒绝             | 全部统一询问和复核；拒绝保留会话，dispose 则明确强制终止                                             |
| L15  | 懒恢复的未挂载文档、项目独立状态                                       | 不为关闭布局项加载全部 Router；独立状态在 workspaceLeave 仍能阻止退出                                |
| L16  | 初始化/拖拽/导航/决定/清理期间 dispose                                 | 撤销晚到提交，已知资源结算，重复终止无重复业务动作                                                   |
| L17  | dirty/写入未知时同文档 go/back/forward 与筛选                          | 真实 from/to 经过同一保护；拒绝不移动；允许的同资源路线保留草稿，key 变化不销毁内容                  |
| L18  | allow 后慢 loader/redirect、失败/取代、owner 隐藏、批次他项拒绝        | 编辑命令入口持续受保护；全部尝试正确结算并幂等释放临时冻结；未进入 pending 也无泄漏，无虚构最终 veto |
| L19  | T1 已提交 history 未接纳，T2 被其他 blocker 拒绝；defer 晚登记/抛错    | from 仍是实际已接纳资源；T2 只释放自己的暂停引用；全部清理一次，重入不见半结算，错误只报告一次       |
| L20  | 同地址 navigate、invalidate/load、错误重试引发 redirect                | 无批准链在位置改变前决定，拒绝保留资源并正常结算；已批准链不重复询问，不因 ignoreBlocker 默认放行    |
| L21  | T1 的 Worksplit blocker 已允许，其他 blocker 暂停；T2 完成后 T1 晚允许 | T1 不得再改写 history/发布；最终位置为 T2，索引匹配真实 entries，T1 暂停恰好释放                     |

### 原生菜单、布局与焦点

| 编号 | 场景                                                      | 必须观察到的结果                                                                                |
| ---- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| N01  | 默认文档/工具/组/窗格/Border 菜单                         | 适用能力完整；原生布局限制和文档角色正确，无业务 UI 依赖                                        |
| N02  | 折叠组中的 close-all/others/right/group                   | 范围含不可见成员，过滤原生不可关项；整批批准，不借用可见 getTabNodes 列表                       |
| N03  | 菜单打开后锚点删除/移动、批准期间范围增减                 | 执行重查节点和范围；待批准请求失效，不作用于重用 ID                                             |
| N04  | Shift+F10/ContextMenu、组编辑、取消、再次打开             | 无双菜单；键盘全程可达，原生菜单清理不抢走对话框或新文档焦点                                    |
| N05  | 默认菜单定制、完整接管与 React provider                   | 文案/条目可改；接管配置冲突明确失败；自定义渲染保留 provider                                    |
| N06  | native singleton group 移出、整窗格含组关闭               | 原生节点和存活内容不丢失；原缺陷有回归，补丁/适配可独立判断                                     |
| N07  | 拖动、ADD/MOVE、首个容器、超限、未知 batch                | 真实接纳一致；unsupported 在变更前拒绝，不以 MOVE 预测 ADD                                      |
| N08  | 原生回调抛错或改变后续成员 token/owner                    | 后续破坏步骤重新复核并保留失效成员；实际部分效果与清理如实报告，无假回滚或假 denied             |
| N09  | 工具/文档跨中央与 Border 移动，原生重命名后导航/恢复      | 角色不变；手动名称跨 key 保留；自动候选不覆盖手动名；查询位置正确                               |
| N10  | 晚到 focus、用户另点输入框、工具与 shell 焦点             | 旧请求失效；工作文档、实际焦点和浏览器地址按契约分开                                            |
| N11  | 最大化中 activate/reveal、组折叠、Border 隐藏             | 明确揭示行为；不需要宿主重复 Actions，不隐式改成相反产品策略                                    |
| N12  | 高频查询/selector/策略预检                                | 不调用完整序列化或 save listener；无无关全树重渲染                                              |
| N13  | 2×2、最大化、折叠、工具/文档跨中央与 Border、卸载 Layout  | visible 随真实显示变化，独立于 active/focused；应用可据此暂停读取而不销毁草稿，无逐文档快照查询 |
| N14  | 自定义条目/renderer、程序 scope close、折叠组与空范围     | 共用完整范围和一次执行；renderer 不重做批准；失效/变化拒绝，空范围成功，无强制删除不可关容器    |
| N15  | 只读无 controller、一次性 focus、内容未绘制、用户另行聚焦 | 默认可聚焦内容根；自定义请求沿同一调度且可被撤销，无 rAF 猜测或过时业务定位                     |
| N16  | 手动名恰等自动名、筛选/下探、自动业务名、工具/文档恢复    | 显式 name 写入均保留手动意图；自动候选不覆盖；可见文本、aria/overflow同源，复制从自动开始       |

### 历史、恢复、制品与真实接入

| 编号 | 场景                                                                                            | 必须观察到的结果                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| H01  | start、open、内部导航、activate、close                                                          | push/replace 与历史行为表一致，拒绝不发布 URL                                                                  |
| H02  | 快速 Back/Forward、拒绝恢复期间新打开                                                           | 最新操作接纳，物理索引恢复正确，无重复 push 或滞留错误 URL                                                     |
| H03  | 外部范围允许/拒绝/取消/接管失败                                                                 | 正常通知与异常分开；共享批准，不由宿主再做一套关闭循环                                                         |
| H04  | 空 home、带 basepath 深链接、数组 search、hash                                                  | 原生编解码和明确首页规则成立，不产生占位文档                                                                   |
| H05  | 两工作台同页、不连接浏览器、同 Window 重复连接                                                  | 无全局监听泄漏；同 Window 所有权冲突明确失败                                                                   |
| H06  | 旧 scope/外层 Router state/未知索引                                                             | 不破坏别人的 state；隔离版本适配并记录无法恢复的边界                                                           |
| H07  | 真实 Router 与唯一 history 的五类导航、异步 blocker、分支截断、同 href 不同 state、同步订阅重入 | 全链后复核再分配实际索引；GO 目标不漂移；拒绝无成功 notify/悬空 Promise；重入不覆盖新提交                      |
| H08  | created/starting/running/disposed、启动期遍历、重复 start、StrictMode                           | 一次启动拥有初始化及可选浏览器；半启动不加载内容或接收变更；失败释放，终态不复活，旧加载不覆盖新条目           |
| H09  | A→B→C，浏览器返回 B 后页面返回 A；同 href 不同 state；页面直接 GO 后浏览器 Back                 | 原实例/entry 的 state 与父层保持；文档 GO 记一次前台访问，browser visit 不再 push，不混用两类 delta            |
| H10  | 原 entry 被 REPLACE/截断、同 ID 重开、重载会话、URL 回退后再次遍历                              | 旧引用不命中新寿命或同 href 别项；URL 回退建立并重绑新实例，无伪父层/草稿复活，拒绝恢复原 browser entry        |
| S01  | 分组、pin、名称、Border、最大化的新版快照                                                       | 原生形态与内容恢复一致，后台文档懒加载                                                                         |
| S02  | version:1、未知工具、重复 ID、非法角色/URL                                                      | 明确拒绝、原输入保留；无自动转换、修补或清空                                                                   |
| S03  | createSnapshot、退出快照与一般查询                                                              | 仅显式导出/已启用的最后导出触发 save listener；同一实现，导出无可变运行引用，不把 snapshot 当草稿保存          |
| S04  | 新开、复制、恢复含下探 URL；旧业务读取依据失效                                                  | 不复制或伪造阅读父层；页面 fallback/不可用状态由应用提供，不以最新结果替换旧依据                               |
| S05  | namespace 与宿主 config、恢复后导航、native save listener、失效通知                             | 宿主字段保留；角色/URL只导出一处，不成为运行镜像；布局/URL变化通知writer，纯焦点不通知，结构校验不请求业务数据 |
| S06  | 节流尚未 flush 时正常/外部退出、批准期间编辑布局、导出异常/重入、终止后存储失败                 | 终止前导出一次并复核；导出失败保留会话，存储失败保留已终止事实；旧 writer 不覆盖最终快照，未启用不序列化       |
| S07  | starting 期间外部退出、强制 dispose、拒绝退出、重复 closeWorkspace                              | 不导出半启动/清空布局，不额外 save listener，不阻塞强制终止；幂等结果不重复导出或通知宿主                      |
| P01  | demo 与独立 tarball 工作台消费                                                                  | 只用公开导出；类型、构建、运行、CSS、原生对象唯一性通过；必需修正按公布安装步骤生效，并通过对应缺陷回归        |
| P02  | 独立安装 SplitView                                                                              | 无 Router/FlexLayout/Hotkeys 依赖要求；仅两个发布包，无 core/旧入口，算法与分割交互保持                        |
| P03  | 实际财务与可用 Shell/Studio checkout                                                            | 记录准确 gitlink/安装制品与迁移范围，保留业务保护；未运行项明确列出                                            |
| P04  | 桌面和窄窗格键鼠、拖拽、焦点、滚动、菜单                                                        | 真实浏览器验收；财务宿主验证实际 2×2，不能只靠 JSDOM/截图                                                      |

### 现有验证入口的使用

| 不变量                  | 现有起点（实施时可合理重组）                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router、身份、URL、home | [router-proof](../../packages/react/src/router-proof.test.tsx)、document-operations、document-boundaries、basepath-history、workspace-home                                               |
| 放置、拖放、政策        | [document-placement](../../packages/react/src/document-placement.test.ts)、document-link、layout-policy、layout-policy-integration                                                       |
| 原生组、名称、工具      | [native-singleton-group](../../packages/react/src/native-singleton-group.test.ts)、native-layout、native-title-ownership、resolved-tools                                                 |
| owner、焦点、React      | [lifecycle-replay](../../packages/react/src/lifecycle-replay.test.tsx)、lifecycle-suspense、focus-lifecycle、border-reveal、tool-activation                                              |
| 资源与重入              | [content-effects](../../packages/react/src/content-effects.test.ts)、content-effect-integration、content-close-reentrancy、content-capnweb                                               |
| 呈现、键鼠、原生接线    | [workbench-native](../../packages/react/src/workbench-native.test.tsx)、workbench-customization、workbench-content-keyboard、[共享浏览器回归](../../scripts/check-workbench-browser.mjs) |
| 外层历史交接            | [host-history-handoff](../../packages/react/src/host-history-handoff.test.ts)、[浏览器实例回归](../../packages/react/src/browser-history.test.ts)                                        |
| 真实包消费              | [check-package-consumer](../../scripts/check-package-consumer.mjs)、[check-package-browser](../../scripts/check-package-browser.mjs)、[同源实例](../../packages/demo/src/main.tsx)       |
| 声明与性能              | [source declarations](../../scripts/check-source-declarations.mjs)、[Workbench measure](../../scripts/measure-workbench.mjs)、[native measure](../../scripts/measure-native-layout.mjs)  |

原来验证财务 2/4 窗格或固定 35% 的库测试迁到应用策略示例/宿主；不能因此删除异步有效性、ADD 拓扑或焦点保护用例。
最终依仓库入口执行定向测试、类型/构建、根 verify、浏览器与独立制品验收；任务串行并保留缓存。
无法运行的真实宿主、浏览器或系统能力记录环境与缺口，不写“所有消费者已验证”。
