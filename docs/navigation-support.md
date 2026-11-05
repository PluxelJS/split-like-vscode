# 原生导航支持与补丁边界

本页拥有 Worksplit 文档 Router 的支持版本、必需修正、公开接线和移除条件。
业务离开批准仍由[整体契约](architecture.md#decisions-and-native-navigation-receipts)定义。
这里的原生能力验证不等于 Worksplit 全部迁移、浏览器交互或财务宿主验收完成。

## 支持版本与实际安装

当前固定组合：`@tanstack/react-router@1.170.46`、`@tanstack/router-core@1.171.39`、
`@tanstack/history@1.162.5`。三个包分别需要仓库 `patches/` 中的同版本补丁。
仅安装相同版本号不能获得这些能力。制品消费者按 [README 安装步骤](../README.md#install)执行
包内 `native-dependencies/install.mjs`；该离线安装器由[制品脚本](../scripts/native-dependency-artifact.mjs)
在 build/prepack 时生成，实际安装后的源码、ESM、CJS 与声明共同接受验证。
不向消费者打包第二份 React、Router 或 history，不在运行时猜测能力后切换另一条实现。

Worksplit 是客户端会话。文档 factory 返回原生 Router，runtime 通过公开
`router.update({ isServer: false })` 明确客户端执行；直接验证上游能力的无 DOM 测试同样
显式设置客户端模式，并使用浏览器条件导出。服务端渲染、`reloadDocument`、外部 redirect 和
整页导航不属于文档会话保护；宿主先执行受保护工作台退出，再接管页面导航。

## 为什么需要三个修正

| 包           | 未修正版真实反例                                                                                | 修正边界                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| history      | memory BACK/GO/FORWARD 不运行 blocker；旧异步 PUSH 晚提交并使用过时索引                         | 唯一原生 memory entries；五类请求身份、全 blocker 链后的同步复核、精确提交和终态             |
| router-core  | 原生 navigate 拒绝不结算；reload redirect 使用 ignoreBlocker；全局完成 Promise 无法关联具体请求 | 实际 load transaction 持有原生请求；真实 redirect 传递批准归属；本次调用结果、后台与销毁结算 |
| react-router | RouterProvider 卸载后遗留等待 React acknowledgement 的 startTransition                          | effect 安装/清理呈现接线，卸载结算 acknowledgement 并恢复后台执行                            |

这些修正不重写匹配、loader、redirect 解析或 React 调度。memory history 的原有存储实现由
同一份原生存储替换；不在 `createMemoryHistory` 旁维护第二组 entries。

## 公开接线

`@tanstack/history` 增加以下类型。它们是上游补丁公开能力，Worksplit 的业务 API 不要求页面直接管理这些对象。

```ts
type HistoryNavigationResult = "accepted" | "denied" | "superseded" | "failed";

interface HistoryNavigationOutcome {
  status: HistoryNavigationResult;
  navigation?: HistoryNavigation;
  error?: unknown;
}

interface HistoryNavigation {
  readonly currentLocation: HistoryLocation;
  readonly nextLocation: HistoryLocation;
  readonly action: HistoryAction;
  readonly parent?: HistoryNavigation;
  readonly signal: AbortSignal;
  readonly committed: Promise<boolean>;
  readonly finished: Promise<HistoryNavigationResult>;
  readonly result?: HistoryNavigationResult;
  readonly error?: unknown;
}
```

`createMemoryHistory({ initialEntries, initialIndex?, requireNavigationApproval: true })` 返回
原生 `MemoryHistory`。其 push/replace/go/back/forward 返回本次 `HistoryNavigation`。
`committed` 只表示 history 已改写。普通独立 history 请求在实际写入及同步订阅通知结束后自行以
accepted 结算；观察者和它返回的 Promise 不拥有导航寿命。Router 通过 `claimNavigation(navigation, owner)`
在发起请求的 `onNavigationStart`，或收到原生 history 的同步 load 通知时认领该请求，之后 `finished`
才等待这个 Router 的实际接纳或确定终止。同一请求不能由两个 Router 认领，终态释放 owner 和
blocker 检查引用。`requireNavigationApproval` 仅控制批准，不能被当作 Router 是否存在的标志。
这使未接入 Worksplit 的普通 `createMemoryHistory` 用法也能正常结束，不把每次已完成写入保留到 destroy。

`signal` 在本次尝试结束时 abort，不表示保存结果或远端工作撤销。拒绝和取代均正常结算，
失败还保留 `error`。父请求在真实 redirect 子链结束时一并结算，错误也沿同一父链保留。

history 的订阅通知和 `BlockerFnArgs` 增加 `navigation`。`NavigationBlocker.beforeCommit(args)`
是同步布尔检查，必须在完整异步 blocker 链结束后、实际 entries 改写前运行。
每项检查后的同步重入也要复核；最后一项检查启动新导航或销毁 history 时，旧请求不能继续写入。
批准绑定原请求的 args，继承批准的 redirect 重新复核原批准，不按 URL 重新找到一张通行证。

`MemoryHistory.signal` 是唯一实例寿命。`destroy()` 终止未提交请求以及已提交、初次加载、重载和后台加载，
使晚到结果失去发布资格，同时释放 blocker 和订阅；终态后的登记立即返回空清理，不继续保留回调。
当前 Router transaction 保留一个实例监听；后继、失败和销毁清理该监听，
反复导航不会保留每代 transaction。`getEntry(key)` 查询真实会话 entry；replace 或分支截断后返回缺失，
不按 index 或 href 冒充原 entry。`completeNavigation(navigation, result, error?)` 供原生 Router 在真实结算点调用；
`claimNavigation` / `completeNavigation` 是上游 Router 与 history 的结算协议扩展，页面不应调用它们
伪造批准、接纳或延长寿命。认领必须发生在同步发布结束前，不能以延迟微任务或订阅数量推断 owner。

原生导航 options 另有 `onNavigationStart?: (navigation: HistoryNavigation) => void`，
在真实请求已登记、blocker 尚未运行时同步通知。它沿同址 load 到实际 redirect 的路径传递；
没有创建 history 请求的普通重载不虚构 start。程序包装由此明确取得本次尝试的清理错误归属，
无需 ambient 调用栈标记、URL 猜测或延迟一个微任务再决定向谁报告。
start 回调同步重入会按真实开始次序取代旧请求；抛错则在 history 提交前以 failed 结算。

Router 的原生 `NavigateOptions`、`commitLocation` options 和 `load` options 增加
`onNavigationResult?: (result: HistoryNavigationOutcome) => void`。原有路由泛型和 `Promise<void>` 保留。
回调按本次原生调用精确执行一次，包括同址重载、被取代和重载 redirect 的拒绝；交付的是终态对象快照。
回调抛错会使本次调用报告错误，但不能改写已接纳的 receipt；Worksplit 组合宿主回调时单独报告其异常。
它是结算通知，不是最终 veto。程序调用通过该回调取得自身结果，不比较前后 URL 或猜测最新请求。

文档 owner 使用 `history.subscribe(router.load)`，与 RouterProvider 的原生订阅保持同一函数身份。
memory history 对相同 callback 的订阅引用计数，只通知一次，各 owner 分别释放自己的引用。
后台 native navigate 识别真实 loader 订阅；仅有观察者也不会错误地跳过加载。Provider 卸载后恢复原有
startTransition；真实 StrictMode mount/unmount 后的后台导航与从未挂载的后台导航分别验证。

## 批准与保护不是同一个事实

真实已批准导航可以包含多跳 redirect 和同地址 redirect hop，沿实际 transaction 的父请求继续一次批准。
普通同址 navigate、load、invalidate 和错误重试没有这项归属；其 redirect 在改变位置前重新询问。
`ignoreBlocker` 单独不授予文档导航许可。

还有一个容易遗漏的间隙：T1 已获准并提交 `/slow`，但最后接纳资源仍是 `/a`；这时对当前真实 entry 重载。
重载继续持有 T1 对 `/a` 的临时保护，直到重载接纳或终止。它没有 T1 的 redirect 批准：
正常接纳 `/slow` 后才释放保护，若 redirect 到其他位置则重新进入 blocker。
上游 transaction 内分别记录实际导航归属与同 entry 的保护移交，二者不通过 URL 或全局当前请求推断。

T1 仍在加载、T2 被其他 blocker 拒绝时，T2 只释放自己的暂停引用。T1 的保护保持至其实际接纳。
错误页是原生接纳；history 已改写后发生的 observer/解析异常不声称没有效果。
原生 Router.emit 已自行捕获通知异常并报告，补丁没有把通知改成 veto。

取消回调也可能同步开始另一请求。新请求先取得 pending 身份，再终止旧请求；取消回调发起的更晚请求
可以取代当前请求。旧调用恢复后不能覆盖更晚请求的身份或遗失其终态。

## 浏览器位置适配

浏览器协调只记录内容寿命与原生 entry key 的引用，不复制文档 state。浏览器访问与文档导航通过本次
`onNavigationStart` 的实际 receipt 关联；同 URL 的不同原生 entry 仍可形成不同浏览器访问。
初次连接在最终接纳前不写 metadata；启动中发生的有效遍历替换同一次 start 的目标。

拒绝浏览器遍历后的物理恢复优先使用公开 `Navigation.currentEntry.index`；没有该能力时使用外层
TanStack browser history 的 `__TSR_index` 协议。整个连接使用同一坐标系，同时保留原生索引基准和宿主 state。
其他 workspace、旧 scope 和没有 Worksplit metadata 的条目均属于宿主，不根据 URL 冒领。
如果外部条目既无可用 Navigation API 位置，也没有原生索引，平台没有公开能力推导恢复 delta；
库会报告该恢复限制，不猜位置或改写外部条目。已批准的正常宿主接管仍可执行。

## 可执行证据与移除条件

同一份[回归](../scripts/navigation-gate-regression.mjs)从消费者根解析真实安装包，命令为：

```sh
node --conditions=browser scripts/navigation-gate-regression.mjs /absolute/consumer/root
node --conditions=browser scripts/navigation-gate-regression.mjs /absolute/consumer/root --cjs
node scripts/check-navigation-patch-runtime.mjs /absolute/consumer/root
```

未补丁的同版本安装可加 `--baseline`，复现 traversal 绕过、旧 blocker 晚写/索引失配、native navigate
拒绝不结算，以及无批准 reload redirect。补丁后的矩阵包含五类 history、最终复核、相同 href 不同 state、
entry 失效、同步重入、重叠冻结、正常/重定向重载、错误页、精确回调、实例销毁、监听数量和真实 Provider 卸载。
成功的初次 load 与无 history 请求的同址重载也必须返回 accepted。生成一致性检查将原生 memory history、
三个 Router 方法及三个 load transaction 函数从已安装的 TypeScript 源码剥离类型，逐项核对 ESM/CJS 完整生成片段；
不能只在源码加入结算而遗漏实际运行产物。
这些是 Router/history 和 JSDOM React 的能力证据；不能代替原生浏览器拖放、布局、菜单或财务分屏验收。

独立制品门还运行严格 ESM/CJS 类型检查、必需补丁 SHA-256 校验、native singleton 和 CSS 检查。
ESM 和 CJS 各用独立类型程序，避免把上游两种声明的全局注册及名义类型错误混成一个应用。
最终执行结果由[制品门](../scripts/native-dependency-gate.mjs)及现行验收记录保存；本页不保存执行日志。

移除任一补丁前，需要上游正式支持相同的请求/转换身份、全链后提交复核、原生调用结算与实例/Provider寿命能力，
并在**没有该补丁**的独立安装上通过同一回归及相应浏览器验收。升级版本或拥有同名 API 都不足以替代这一步。
通过后删掉对应补丁、安装条件和内部接线；不保留版本探测、旧批准策略或第二执行路径。

## FlexLayout public capabilities

The same artifact also carries the exact `flexlayout-react@0.11.1` correction. This published
package contains `dist/index.js` and declarations, but no `src` tree or separate CJS build;
all shipped runtime/declaration targets are checked against upstream hashes.

- Singleton groups retain their native group/tab identities when members leave.
- Public `ILayoutApi.endDrag()` ends the owning Layout's native drag and overlays. A late
  `dragleave` after owner cancellation clamps the native enter counter at zero, so the next
  actual drag can begin normally. The independent browser fixture reproduces cancellation,
  late events and subsequent drag at desktop and narrow sizes.
- Native group color swatches support arrow keys, Home/End and wrapping focus. `PopupMenu`
  preserves embedded input editing and native button Enter/Space activation, while Escape/Tab
  still dismiss the menu. The independent native fixture covers the actual browser key defaults;
  Worksplit does not replace the group controls or intercept their keyboard events.
- Public `Model.getGlobalAttributes(): IGlobalAttributes` returns detached native global
  attributes without a save event or Model change notification. Detached admission candidates
  use these attributes to present the same inherited close/drag/group facts to host `allowDrop`.

The last capability is needed because the unpatched Model has no public global query:
`toJson()` fires each tab's `save` listener, while constructing a detached candidate without
native globals can turn an actual `tabEnableClose:false` into `true`. A cached mirror of prior
attributes would create another authority. `scripts/fixtures/native-dependency/globals.mjs`
reproduces all three facts before patching, then proves detached values, exact candidate
inheritance and visibility of a later native attribute update with no extra events.

Remove each correction only after an upstream version supplies the equivalent public capability
and passes the same unmodified isolated regression and actual browser cases. Re-run source/type,
unique native identity, patch installer and final packed-consumer gates on that version. Package
version equality, a workspace-only patch or a mocked Layout is not evidence of delivery.
