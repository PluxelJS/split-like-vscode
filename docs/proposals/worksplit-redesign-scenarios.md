# Worksplit 重构的场景证据与反例

本页保留 **2026-11-04 实施前预演**中决定架构的原件观察、用户路径和反例；不把当时的源码状态或静态推演写成本轮运行结果。
现行 API、所有权和行为分别由 [README](../../README.md)、[架构](../architecture.md)和[行为契约](../vscode-workbench-behavior.md)维护。
完整旧预演与接口草图通过 Git 追溯；本轮验证与未完成项见[提案导航](README.md)。

## 原件与探针的证据边界

| 对象       | 2026-11-04 的依据                                                                      | 证据用途                                             |
| ---------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Worksplit  | 设计提交 `4b0cfa7`；运行代码 `265bbed1`                                                | 观察旧公开入口、实现和保护测试，不代表当前 checkout  |
| 财务工作台 | 场景基线 `0ce93ea4`；复核 `financial-workbook` 的 `39721c93`                           | 用户路径、业务 owner、快照 writer 与退出次序         |
| history    | 实际安装和当时子模块 lock 均为 `1.162.5`                                               | memory traversal 与异步 blocker 的真实缺口           |
| Router     | 实际 react-router `1.170.46` / core `1.171.39`；当时子 lock 为 `1.170.42` / `1.171.35` | 当时探针只证明实际安装版本；声明相近版本不能继承证据 |

以下探针针对**未补丁原生包**。memory history 探针提供启用 blocker 的 document 环境；Router 探针使用 Node v24.16.0、隔离 JSDOM 和 `node --conditions=browser`。
普通 Node 服务端条件下的早期探针不计作客户端证据。它们没有启动财务宿主、RPC 或数据库，也没有证明业务数据已经丢失。
当时原始脚本和结果保存于财务仓库忽略目录 `.artifacts/worksplit-review/`。

| 操作                                                              | 实际观察                                                   | 排除的假设                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| entries `/a`、`/b`，永远拒绝的 blocker；`go(-1)`，再 `push('/c')` | GO 到 `/a` 且 blocker 0 次；PUSH 留在 `/a` 且 blocker 1 次 | 原生提供 history API 不等于五类操作都有离开保护      |
| 已在 `/a`，再 navigate `/a`，beforeLoad redirect `/b`             | 最终 `/b`，blocker 0 次                                    | 同址重载不保证仍留在原资源                           |
| 相同准备后 `invalidate({ sync: true })`                           | 最终 `/b`，blocker 0 次                                    | 刷新、错误重试不能天然借用一次旧批准                 |
| T1→`/b` 的首 blocker 允许、第二个等待；T2→`/c` 完成，再允许 T1    | 从 `/c` 晚提交到 `/b`；两次 PUSH 后 length=3、index仍为1   | 首次允许与最终提交复核不能合并，提前分配索引也不安全 |

相关旧原生入口是 `createHistory.tryNavigation`、`createMemoryHistory`、Router 同址 load 和 `followRedirect` 的 `ignoreBlocker`。
这些证据要求识别真实导航请求、完整 blocker 链后的提交资格及 redirect 批准来源；不能用 URL、`approved[href]`、事后回滚或只结算库自己的 Promise 替代。
当前固定版本、最小修正、同一回归与移除条件集中在[原生支持边界](../navigation-support.md)，此处不再复制补丁 API。

另有一项**当时的静态发行证据**：旧独立消费脚本按本机版本号重新 `npm install`，没有传递工作区的 FlexLayout `patchedDependencies`。
所以同版本号不能证明消费者拥有单成员组或 `endDrag` 修正；当时没有重跑该制品，不把这个观察冒称运行失败。
现行[独立消费入口](../../scripts/check-package-consumer.mjs)验证真实 tgz、离线安装器及未修正基线；启动前还可使用安装器的只读检查。

## 必须保留的业务区别

以下财务文件名均相对当时财务仓库根，是有提交基线的观察入口，不是库的依赖或接口声明。

| 用户路径与原件入口                                                                  | 错误合并会丢掉什么                                                                                        | 当前契约归属                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 左侧目录首层旁开凭证；`financial-project-owner.ts` 的 preview/entry links           | “在右侧”不能自动推出预览、激活或继续增殖窗格；已有手调尺寸也不能重置                                      | 库负责[放置与呈现](../vscode-workbench-behavior.md#documents-tools-and-presentation)，财务保留最多2×2、凭证首次各半、金额组成右侧588px且比例25%—65%的产品政策；旧“下方35%”不是迁移要求 |
| A试算→B科目组成→C凭证查询→D详情；`financial-document.tsx`、`reading-link.ts`        | 筛选增加history项，但“返回来源”仍应返回阅读父层；复制/恢复URL没有原阅读链                                 | 应用拥有阅读父层，库保留原生 history 与 entry state                                                                                                                                    |
| 金额详情“当前报告”；`currentReportLink`、`report-tab-presentation-browser.test.mjs` | 按 reportProfileId 找已开实例应保留其条件/草稿/滚动；不能为此把所有报告的默认复用身份缩成 reportProfileId | [文档身份](../vscode-workbench-behavior.md#documents-tools-and-presentation)与业务实例选择分开                                                                                         |
| 手动标题恰好等于自动标题；`financial-workspace.tsx` 的旧字符串比较                  | 文字相等不能证明自动所有权；rich label不能绕过native name导致可访问名不同                                 | [原生命名](../vscode-workbench-behavior.md#native-actions-and-names)                                                                                                                   |
| 2×2四个可见页面，焦点转到问题工具；`read-visibility.tsx`、旧布局JSON解析            | 可见、选中、聚焦、工作文档不是同一状态；工具移到中央仍是工具                                              | [可见性与焦点](../vscode-workbench-behavior.md#focus-visibility-and-cleanup)，读取/RPC需求留业务owner                                                                                  |
| 旧金额组成按 resultId 返回；`report-amount-workspace.tsx`                           | 布局恢复不能重建内存计算依据，更不能用最新金额冒充旧依据                                                  | 应用表达业务结果不可用，库只恢复有效布局与URL                                                                                                                                          |

## 浏览器 entry 不能退化成地址

B 的文档 entry 保存 parent=A。用户从 C 按浏览器 Back 到 B，再点页面“返回来源”，必须仍能找到原 A。
如果浏览器协调仅按 B 的 href 调用 navigate/replace，地址虽正确，B 自己的 state 却可能消失。
两次访问同 href 而 state 不同，同样不能合并；页面返回是新的前台访问，浏览器触发的遍历不能额外制造一次访问。

原 entry 被替换或分支截断，以及关闭后同 ID 重开，都会使旧引用失效。原 index 此时可能指向别的 entry，不能假装恢复成功。
具体关联、失效回退与严格快照边界由[浏览器条目与恢复](../vscode-workbench-behavior.md#browser-entries-and-restore)拥有。
这个反例保留的是应用 entry state 的意义，不要求复制一份影子历史或把业务 state 塞进浏览器条目。

## 保存批准不等于保存依据或资源接纳

`document-scope.ts` 区分业务资源与一次连续停留：A→B→A 后，旧 A 回调不能因地址又相同而复活。
筛选改变复用身份也不一定离开资源；资源引用不能跟随原生临时匹配提前切换。

- 保存请求捕获资源 A、编辑修订 e7。保存等待期间若允许出现 e8，成功回执只证明 e7；不能改拿“最新 token”批准未保存的 e8。
- pending 状态可改变 token，正常变化不自动等于失败。应用必须检查实际保存依据并保护后续编辑，再交出可复核批准；暂停释放绑定原资源和该次请求。
- T1 已提交 history、loader 尚慢，T2 又被其他 blocker 拒绝：结束 T2 不能解除 T1 的暂停。已接纳资源仍是 A，不应从临时地址 B 推断编辑器已经换资源。
- 未知写入可在 `hasUnsavedChanges=false` 时拒绝退出；终止信号也不证明远端写入已取消。业务复制已提交而后续视图打开失败，不能报告“复制未发生”或自动重复写入。

[内容资源寿命](../resource-lifetimes.md)拥有当前协议，[同一个可运行编辑例子](../../packages/demo/src/examples/editor.tsx)与其[实际保存存储](../../packages/demo/src/examples/editor-store.ts)承载公开接入证据。
本页不另设保存回执、CAS或通用业务版本协议。

## 退出快照与最后写入

当时财务 snapshot writer 节流150ms，正常退出与外部历史接管在终止前flush。拖动分屏后立即退出，或确认期间又改变布局，均可能使磁盘快照落后。
终止后再向运行实例导出已经太晚；导出触发的save listener又可能重入改变批准或结构。
最终快照必须在仍可验证的终止点取得，旧节流写入必须先停止，存储失败应报告“已终止但未持久化”而非假装回滚。
精确导出、失败与强制dispose边界集中在[恢复说明](../vscode-workbench-behavior.md#browser-entries-and-restore)。

## 保留这些反例的用途

它们约束的是所有权、真实提交点和消费者成本：常用菜单/范围关闭/旁开/焦点不应让财务再次复制协调；业务阅读、共享草稿、保存依据、尺寸政策也不应搬进库。
旧core运行时消费者只有SplitView算法，构建引用本身不是独立公共包的需求。当前[包边界](../../README.md)据此只保留两个用途明确的包。
新的维护工作应从这些反例和现行契约判断是否需要改变设计；不能把历史测试通过数或静态预演当作当前宿主、独立制品或外部Shell/Studio已经迁移的证据。
