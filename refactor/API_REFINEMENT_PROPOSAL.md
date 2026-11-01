# Worksplit API 与资源生命周期精进提案

状态：2026-11-01 复核契约已实施，Worksplit 与 Pluxel 已知消费者在同一批次迁移；实际验证与未验证边界见[本轮实施验收](API_REFINEMENT_VALIDATION.md)。初稿：2026-10-30；设计复核：2026-11-01。审查前实现基线：Worksplit `755cbe1`。

**内容接入统一到 `useWorkbenchContent()`：在 hook 参数中声明编辑决策，通过返回的 `content.effect()` 管理资源。** React 继续管理依赖和组件挂载；Worksplit 负责把每次 effect 的资源接入内容关闭结算。

这是一次替换：迁移全部已知调用方后删除旧 lifecycle hook、命令式 register 和应用自建资源登记层，不保留兼容 alias。不新增上一版提出的 `registerResource()`。本文保留设计取舍和验收要求；当前公开用法见 [README](../README.md) 与[资源契约](../docs/resource-lifetimes.md)。

## 1. 改进范围与取舍

| 项目           | 建议                                                          | 依据                                                                              |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| R1：内容接入   | 一个 hook、一个资源 effect 操作；编辑决策与资源各自有明确寿命 | 现有入口要求稳定 lifecycle 对象；Pluxel 自建资源集合；异步示例手写 closed/session |
| R2：布局预检   | 修复 `canDispatch(ADD_TAB)` 触发真实 tab 的 save 回调         | 已隔离复现，见下文                                                                |
| R3：结果与报告 | 回执供调用方处理，无等待者的错误才走 onIssue                  | 现有 close 同时返回并上报错误，Pluxel 两边都展示                                  |
| R4：内部清理   | 一处实现 effect 结束和资源结算，删除旧登记/重放协调           | 服务于 R1，不按文件长度拆管理器                                                   |
| R5：维护文档   | 区分源码已接入、历史验收和未实现提案                          | 架构页仍将 Pluxel 本体迁移描述为未来事项                                          |

保持唯一 FlexLayout Model、每文档真实 TanStack Router 和 Worksplit 会话协调。业务身份、修订、权限、共享数据、RPC transport 和持久化仍由应用拥有。审查范围是这条接入路径及其真实消费者，不是整个 Pluxel 或 SplitView 的全面重构。

“一套入口”指一套内容接入契约，不把 `open`、`close`、查询和原生 Actions 合并成一个万能函数。同步查询与异步操作继续表达各自真实行为。

普通作者只需选择资源的真实所有者：

| 需求                                           | 默认写法                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| 声明脏状态、保存、离开确认或焦点               | `useWorkbenchContent(lifecycle)`                    |
| 获取资源，要求内容关闭也能停止并等待已知清理   | 原生 `useEffect` 返回 `content.effect(...)` 的 stop |
| 仅组件局部行为，不参与内容关闭结算             | 普通 `useEffect`                                    |
| 关闭页面后仍要存续的连接、缓存、共享草稿或任务 | 应用 owner 持有；页面只释放自己的使用权             |

设计收益以删除实际重复职责衡量：页面无需再手写通用资源集合、晚到资源释放和异步 cleanup 上报。业务保存、资源身份与协议释放顺序仍由业务表达；减少 hook 数量本身不算收益。以下低频时序由库实现和回归保证，不要求每个页面复制状态机。

## 2. R1：以 content 为唯一接入对象

### 2.1 公开契约

以下声明已导出；`WorkbenchLeaveContext` 沿用现有契约。可选回调也允许显式 `undefined`，使动态 getter 能撤回某项能力。

```ts
export interface WorkbenchContentLifecycle {
  isDirty?: () => boolean;
  getCloseRevision?: () => string | number;
  beforeLeave?: (
    reason: "close" | "navigate",
    context: WorkbenchLeaveContext,
  ) => boolean | Promise<boolean>;
  save?: () => void | Promise<void>;
  focus?: () => void;
}

export interface WorkbenchContentEffect {
  readonly signal: AbortSignal;
  defer(cleanup: () => void | Promise<void>): void;
}

export interface WorkbenchContent {
  readonly id: string;
  executeCommand(id: string): Promise<void>;
  effect(setup: (effect: WorkbenchContentEffect) => void | Promise<void>): () => void;
}

export declare function useWorkbenchContent(
  lifecycle?: WorkbenchContentLifecycle,
): WorkbenchContent;
```

- 无参数或 `undefined` 只取得 content，不占用编辑决策 owner；传入对象（包括 `{}`）则声明该 hook 是 owner。一个 content 仍只允许一个编辑 owner。
- lifecycle 保留已有业务回调名，删除 `dispose`。回调读取最新已提交渲染中的状态，调用方无需为登记身份写 `useMemo`/`useCallback`。
- 返回对象在同一 content 实例中稳定，并绑定该实例而非仅绑定字符串 id；不同组件可以各自调用 `content.effect()`，不竞争编辑 owner。内容结束后，旧 handle 的 effect 和命令入口均拒绝执行，不转投同 id 重开的内容。
- `effect` 在调用时执行 setup，先登记所有权再运行应用代码；它应从原生 `useEffect` 或明确的事件处理启动，不在 render 中调用。
- `effect` 返回一个幂等的同步 stop 函数，可直接作为 React cleanup。异步清理由 Worksplit 跟踪，调用方无需再写 `void release().catch(...)`。
- setup 中只用 `defer` 登记清理，不再同时支持返回 disposer、`use(resource)`、`track(promise)` 等同义路径。上下文只包含 signal 和 defer，不可创建嵌套 scope。

`useWorkbenchContent(lifecycle)` 在 commit 后接入 owner，并更新回调，不能在 render 中改写已生效的注册。被丢弃的并发渲染不得改变关闭行为。现有 lifecycle 的动态 getter 仍在使用时读取，不提前拍平成快照。

同一 hook 从对象更新为另一个对象只更新回调；提交 `undefined` 或结束登记才撤回 owner，随后再传对象属于一次新登记，之前的关闭批准失效。撤回编辑 owner 不停止其他组件的资源 effect，也不代表保存或允许丢弃修改；业务不能靠撤回来绕过离开确认。重复 owner 和失效 handle 属于调用错误，明确抛错；已经接纳的 setup 无论同步抛错还是异步失败，均由 effect 监督、清理并报告。

### 2.2 普通编辑器不需要资源框架

下面是组件内片段，业务 editor 已有 dirty、修订和保存逻辑：

```tsx
useWorkbenchContent({
  isDirty: () => editor.isDirty(),
  getCloseRevision: () => editor.revision,
  beforeLeave: () => editor.confirmLeave(),
  save: () => editor.save(),
  focus: () => input.current?.focus(),
});
```

无需另一个 lifecycle hook、手动 register 或稳定对象包装。仅需读取 content 的工具和子组件仍用 `useWorkbenchContent()`。

### 2.3 Cap’n Web 的最短完整资源路径

以下组件假定宿主提供稳定的 API stub。两个 interface 描述应用契约；Worksplit 不导入 Cap’n Web。

```tsx
import { useWorkbenchContent } from "@worksplit/react";
import type { RpcStub, RpcTarget } from "capnweb";
import { useEffect, useState } from "react";

interface DocumentSession extends RpcTarget {
  title(): string;
}
interface DocumentApi extends RpcTarget {
  openDocument(id: string): Promise<DocumentSession>;
}

export function DocumentPage({
  api,
  documentId,
}: {
  api: RpcStub<DocumentApi>;
  documentId: string;
}) {
  const content = useWorkbenchContent();
  const [title, setTitle] = useState("正在打开…");

  useEffect(
    () =>
      content.effect(async ({ signal, defer }) => {
        setTitle("正在打开…");
        const session = await api.openDocument(documentId);
        defer(() => session[Symbol.dispose]());
        if (signal.aborted) return;
        const title = await session.title();
        if (!signal.aborted) setTitle(title);
      }),
    [content, api, documentId],
  );

  return <p role="status">{title}</p>;
}
```

setup 的未处理失败由 Worksplit 结束该 effect、清理已登记资源并通过宿主 `onIssue` 报告。页面需要行内错误提示时可以在 setup 内捕获、呈现可恢复错误；不要为通用释放再写 finally。

相较[现行示例](../docs/resource-lifetimes.md)，调用方不再保存可变 `session` 容器、`closed` 标记、unregister 函数或通用 catch 上报。仍保留 await 后的 `signal.aborted` 判断：框架能回收资源，不能替任意应用代码决定是否更新 UI。只在页面失效时检查这一标准信号，不再造另一套代次状态。

普通订阅同样通过这条路径接入：

```tsx
useEffect(
  () =>
    content.effect(({ defer }) => {
      defer(service.subscribe(onChange));
    }),
  [content, service, onChange],
);
```

外层原生 `useEffect` 让依赖列表、闭包和 lint 规则保持熟悉的含义。Worksplit 不在 options 对象内藏一套自定义依赖机制。

从事件处理器启动 effect 时，组件卸载不会自动调用其 stop；默认寿命是该次手动 stop 或内容结束。需要组件寿命时用上面的 React 接线，不另建事件专用资源接口。

### 2.4 每次 effect 的寿命与结束行为

资源属于一次 `content.effect()`，而不是一个可被反复借用的全局 tab 资源袋。这解决“同一 tab 已从 A 路由变成 B，A 的资源却晚到”的问题。

| 触发                                      | 行为                                                               |
| ----------------------------------------- | ------------------------------------------------------------------ |
| React 执行所属 effect 的 cleanup          | stop 立即使本次 signal 失效，开始清理；下一次 setup 获得全新上下文 |
| 关闭被拒绝或取消                          | 不停止 effect，资源继续可用                                        |
| 内容正式移除或实例 dispose                | 同步停止所属 effects，再结算已知清理                               |
| tab 激活、后台、原生移动或 Border 收起    | 这些操作本身不停止 effect；React 是否 cleanup 按实际挂载边界处理   |
| setup 中途失败                            | 停止本次 effect，清理已经 defer 的资源，报告真实错误               |
| setup 结束后仍存续                        | 资源继续有效，直到 stop 或内容结束；setup 完成不等于释放           |
| stop 后异步资源才返回                     | 旧上下文的 defer 立即清理它；不能登记到新路由或同 id 重开的 tab    |
| 重复 stop、React cleanup 与关闭交错       | 每次 defer 登记只执行一次 cleanup                                  |
| 旧 content handle 在内容移除后调用 effect | 在执行 setup 前明确拒绝；不创建资源，不附着到新实例                |

同一 effect 的已登记资源按获取的逆序逐项清理，失败后继续后续清理。不同 effect 之间没有依赖顺序；相关的订阅和 capability 放在同一 effect。结束后才登记的资源立即清理，不追溯此前顺序。

每次 `defer` 是一次登记，不按函数或资源 identity 去重；同一个资源只登记一次。stop 必须在通知 abort listener 或执行 cleanup 前标记本次 effect 已结束，重入的 stop 无效、重入的 defer 按晚到资源处理。清理函数不得等待包含自身的 `close`/`dispose`，避免自身等待环。

signal 表示本次使用期限结束。它可传给支持取消的原生 API，也可在 await 后检查；不能据此宣称远端调用已取消。仅与本次 signal.reason 对应的受控取消可按正常结束处理，不能因为 signal 已失效就吞掉其他错误。

### 2.5 关闭等待哪些工作

关闭批准和资源撤销是两个阶段。确认期间 effect 仍可用；拒绝、取消或修订失效不因本次关闭而停止资源。原生移除已确认后，或实例开始 dispose 时，同步撤销对应内容的新 effect 接纳，再确定本次结算范围：

1. 截取该内容各存续 effect 此刻已登记的 cleanup，以及此前 stop 已启动但尚未结算的清理任务；同 id 的旧内容与新内容分开归属。
2. 在调用 abort listener 或 cleanup 等应用代码前固定这份集合并停止 effects；本次操作等待集合内任务，按第 4 节规则接收错误。
3. 截取后登记的资源立即清理，但不延长这次操作，失败走 `onIssue`；即使它在关闭回执返回前到达，也不改变等待集合。尚未完成的 setup Promise 不自动进入集合，晚到 setup 错误仍走 `onIssue`。

此边界不是超时保证：集合内某个 cleanup 不结束，操作就继续等待。必须等待业务任务退出时，把等待登记为 cleanup，使用该业务已有的取消/超时约定；库不增加通用 timeout、retry 或强制成功选项。回执只证明这份已知清理完成，不证明所有远端工作结束；例如调用 RPC stub 的 `Symbol.dispose` 不等于收到服务端释放确认。

stop 返回 void 是为了直接符合 React cleanup。它只启动结束流程，不是远端清理完成回执。需要等待整体结束的宿主使用既有 `close`/`dispose`；不新增每个 effect 的 wait、drain 或状态订阅 API。

### 2.6 React 重放、隐藏与编辑保护

按 [React effect 契约](https://react.dev/reference/react/useEffect)，StrictMode 可以执行 setup → cleanup → setup。新设计允许重新获取资源，并保证第一次 setup 的晚到结果被清理。删除旧 hook 的微任务“保留同一注册”协议，不承诺开发期只连接一次。必须跨 React 重挂载保留的共享会话提升到宿主 owner，页面只持有自己的引用或订阅。

[Activity](https://react.dev/reference/react/Activity) 隐藏时会清理 effects 并保留组件状态，恢复时重新 setup；[Suspense](https://react.dev/reference/react/Suspense) 隐藏已显示内容时会清理 layout effects。因此，组件未卸载不等于 effect 未结束，不能承诺任意 React 隐藏都保留连接。

编辑 owner 放在负责离开决策的持续文档根，可隐藏或挂起的子区域只管理自身资源。库内部也分开处理 owner 登记寿命与最新回调的提交，不因刷新回调的 layout effect 被清理就撤销编辑保护。支持的组合必须验证：子区域隐藏或挂起时，根 owner 仍能拒绝 dirty 内容的关闭；恢复资源不产生第二 owner。整个编辑 owner 随外层 Activity 停用期间继续执行编辑/关闭命令不在本轮支持范围；宿主需要这种行为时应调整边界，使 owner 持续登记。本轮不增加暂停 owner、缓存 dirty 或隐藏恢复协议来模拟支持。

编辑决策 owner 与 resource effect 独立：普通 rerender 更新回调不重建资源；owner 真正替换才使旧关闭批准失效。关闭仍核对 owner、内容版本和业务修订，不能因回调指针变化而让每次输入都重建登记，也不能因 owner 对象稳定就跳过修订复核。

owner 身份来自 hook 的本次登记。若同一组件原地换成另一份业务编辑器，业务修订必须能区分资源身份，或通过 React key 明确重挂载；不能把两个编辑器各自的 `revision = 0` 当作同一批准。Pluxel 已有的编辑 owner 修订组合仍应保留。Studio 实施前的 `editorLifecycle` token 不包含 `workspace/path/kind`；本次已将项目 id/root、path 和 kind 纳入业务关闭修订，并验证同 token 的身份替换使旧批准失效。不能只删 useMemo 就认为等价；不新增公开 ownerId 或另一套业务版本系统。

### 2.7 为什么这次范围足够

每次 effect 拥有 signal、清理集合和结束状态，承担了现有调用方反复手写的真实职责。它不返回加载数据、不缓存查询、不重试、不决定后台任务策略，也不提供通用插件或 scope 树。

只需组件局部清理且无需参与 Worksplit 关闭结算的逻辑，继续用普通 React effect。独立 async 流程也继续使用原生 Promise、AbortSignal 和 SDK，不要求整页所有代码迁入 content.effect。

## 3. R2：预检应避免触发真实 tab 的保存回调

### 实施前已确认的路径

实施前 [integration.ts](../packages/react/src/integration.ts) 的 `allowToolAdmission()` 在存在 `allowDrop` 时调用 `Model.fromJson(model.toJson())` 构造候选；公开 `canDispatch()` 会走到这里。

FlexLayout 的序列化会触发 tab 的 `save` 回调，见[上游事件文档](https://github.com/caplin/FlexLayout#tab-node-events)。已有 [layout-policy.ts](../packages/react/src/layout-policy.ts) 已专门避免在拓扑预检中调用真实 `Model.toJson()`，但工具接纳路径尚未遵守同一边界。

本次只读隔离探针使用公开 `createWorkbench`、原生 Actions，以及 `layoutPolicy.allows` 提供的 Model：

1. 创建一个已有工具 tab 和一个待加入工具，配置 `allowDrop: () => true`。
2. 在已有 tab 上安装 `save` 计数器，只调用一次 `canDispatch(ADD_TAB)`。
3. 检查真实 Model 是否变化，随后释放 Worksplit 实例。

结果：预检返回 `true`，`save` **1 次**，Model change **0 次**，新 tab **未插入**，实例释放错误 **0 个**。执行前核对了构建 sourcemap 内的 `integration.ts` 与当前源码完全一致。

这证明预检会触发保存回调；没有据此声称发生文件写入或数据丢失。

### 实施边界

工具接纳候选应通过不触发真实 save listener 的原生节点数据创建。先核对现有 `topologyCandidate` 能保留哪些信息；它为拓扑检查裁剪过语义，不能直接当作任意布局克隆工具复用。需要保留实际 policy 读取的配置、默认继承和目标信息，并继续由原生 Model 执行候选 Action。

仅在两处所需语义一致时合并私有 helper；不增加公共 `cloneModel` 或第二份长期布局。正式 `snapshot()`/序列化仍保留原生 save 行为。

实现核对发现 FlexLayout 没有无副作用读取完整显式 global 输入的公共方法，而既有拓扑候选裁剪了 policy 所需默认继承。因此 Worksplit 只保留初始 global JSON 及原生 `UPDATE_MODEL_ATTRIBUTES` 对它的显式更新；候选的 root、borders 和节点配置始终读真实 Model 的纯节点数据。候选仍为一次性原生 Model，没有第二份长期布局。回归同时覆盖允许/拒绝 ADD、边栏默认继承和原生 global 更新后的继承。

Pluxel 的 `panelLayoutPolicy.allowsAction()` 同样使用真实 `model.toJson()`，应作为已知调用方一起核对。不能只修库内路径后就宣称所有自定义 policy 都无副作用。

## 4. R3：让回执与错误报告各负其责

实施前 `closeAction()` 返回 `failed`/`cleanupErrors` 的同时调用 `onIssue`。Pluxel 的 `onIssue` 和 `WorkspaceSession.check()` 都会展示错误，代码路径存在重复通知的可能；当时未运行在线 UI 验证通知次数。本次实现已让程序入口只返回回执，由原生 UI 统一消费自己的回执；实际验收见[实施记录](API_REFINEMENT_VALIDATION.md)。

错误接收方由调用入口和清理任务归属决定，不尝试检测外部代码是否真的 await 了 Promise：

- 程序调用 `close`/`dispatch`/`dispose`：操作结果由已有返回值承担，调用方决定提示和后续动作。故意忽略返回值的责任仍在调用方。
- 原生 UI 发起的操作：React/原生入口消费同一个回执，再转给 `onIssue`；并发合并为同一次原生操作时只上报一次。
- 路由后台工作、无等待者的注销清理、成功操作之外的附带清理失败：保留 `onIssue`，不能因主操作成功就吞掉错误。

这会改变现有通知行为，必须同步检查 demo、独立消费者、Pluxel 和所有依赖 `onIssue` 的测试。不要直接删除 `closeAction` 中的上报，也不要添加全局错误去重缓存。

每项内部清理任务只保留一处报告责任，等待它不自动获得第二份报告权：

- 普通 React stop 发起的任务在无人接管时，结算错误交给 `onIssue`。
- 关闭或 dispose 确定等待集合时，接管集合内尚未报告、尚未被其他操作接管的任务；这些错误只进入该操作的返回值。已经报告的错误不再作为后续关闭的清理错误重放。
- close、dispose 交错时，后来者可以等待同一任务，但不重复收取已归属另一操作的错误；同一操作的并发调用仍复用既有结果。截取之后新产生的清理任务独立上报。

例如 React stop 启动慢清理、close 随后接管、清理最后失败，只进入 close 的 `cleanupErrors`。若清理已失败并报告后才 close，则不再通知一次。这里收敛的是库与原生入口的报告责任，不承诺替任意宿主的重复提示去重。

无等待者的错误必须有默认可见结果：保留 `onIssue` 为可选宿主处理器，未提供时由库统一 `console.error` 报告；提供时只调用宿主处理器。本批已修正实施前可选回调缺省后不报告的行为，避免新的 effect 接口捕获失败后静默丢弃。页面不必逐个 effect 重复安装相同 catch。

报告器不能阻断资源结算。宿主 `onIssue` 同步抛错时，库以包含原错误和报告器错误的诊断回退到 `console.error`，继续清理；`onIssue` 保持同步通知契约，不承诺等待宿主的异步处理。

同时导出有明确用途的 `DispatchResult`，先表达现有联合类型，供消费者替代手写 `{ status: 'applied' | 'rejected' }` 拼接。保留当前 discriminated results；不把全部 API 改成一个 Result 包，也不统一同步布尔查询和异步操作的返回形状。

`dispatch` 的普通拒绝目前没有 `reason`。这是诊断能力的限制，但目前核对的消费者仅需通用提示；本轮不为每个内部条件新增错误码。出现真实程序分支需求时，再为该分支补稳定原因及运行时证据。

## 5. R4：内部只维护一条清理路径

现有 [integration.ts](../packages/react/src/integration.ts) 约 2,173 行，行数不是拆分依据。此次只收敛与新契约有关的两项职责：

- React binding：维护稳定 content handle、commit 后的最新编辑回调和唯一 owner 身份；不再维护旧 `PendingLifecycle`、`takePendingLifecycle`、`deferLifecycle` 重放接线。
- 私有 effect 结算模块：维护每次 setup 的 signal、defer 列表、单次结束与正在结算的任务；依赖变化、错误、关闭和 shutdown 都调用同一路径。

Worksplit 协调实例继续决定接纳、原生移除、关闭批准和回执。Router、MRU、焦点、浏览器历史保留原所有者。旧 lifecycle.dispose 和新 effect 清理不能各自保留一套 registry；旧 cleanup 状态迁入唯一结算路径后删除。

effect 模块只维护使用期限、清理任务和第 4 节的报告归属，不建立公开 scheduler、通用 scope 框架或状态订阅。已结算任务从 registry 移除；旧 setup 的晚到 defer 仅保留释放和报告所需上下文，不把旧内容重新挂回 registry。调用方未处理业务错误不能被伪装成取消。

## 6. 一次迁移，删除旧入口

| 当前路径                                                    | 最终替换                                       | 必须删除或修订                                        |
| ----------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `useWorkbenchContentLifecycle(lifecycle)`                   | `useWorkbenchContent(lifecycle)`               | 旧 export、实现、示例和同义 hook                      |
| `content.register(lifecycle)`                               | hook 直接声明编辑 owner；资源走 content.effect | 返回对象上的 register 和公开命令式 lifecycle 注册契约 |
| `WorkbenchContentLifecycle.dispose`                         | 在对应 effect 中 defer 清理                    | 字段及旧 lifecycle cleanup 路径                       |
| 仅为 lifecycle 身份而写的 useMemo/useCallback               | 直接传回调                                     | 无业务必要的稳定对象包装                              |
| Pluxel `WorkbenchDocumentState.registerResource` 与资源 Set | 各 renderer 的 content.effect                  | 资源汇总和 detach 回调，不保留转发 wrapper            |
| 打包消费者的 `release.current` / `disposed` 双清理          | effect 上下文统一释放                          | 同一订阅的 effect/lifecycle 双登记                    |
| 上一版提议的 `registerResource()`                           | 不实现                                         | 不作为替代推荐或兼容入口留在最终文档                  |

迁移需同时覆盖：

- 库公开 exports、内部 lifecycle 测试、demo、[独立安装 fixture](../scripts/fixtures/packed-consumer/app.tsx) 和 API 类型用例。
- Pluxel [document owner](https://github.com/PluxelJS/pluxel/blob/5161c68007cec611b73ded9a6eb435ebf9449f83/packages/workbench/shell/src/app/workbench/document.tsx) 与 [renderer runtime](https://github.com/PluxelJS/pluxel/blob/5161c68007cec611b73ded9a6eb435ebf9449f83/packages/workbench/shell/src/workbench/runtime.tsx)。编辑状态、确认和修订仍由应用保存；Bridge 顺序、RPC stub 和远程资源回执仍遵守领域契约。
- Report Template Studio 的 [FilePane/FormPane](https://github.com/PluxelJS/pluxel/blob/5161c68007cec611b73ded9a6eb435ebf9449f83/projects/report-template-studio/src/renderer/panes.tsx)、编辑 lifecycle 工厂、相关测试及 mock。该项目已有真实消费，不能只迁移 Shell 和 demo。
- README、[资源专题](../docs/resource-lifetimes.md)、行为文档、工程入口、生成/示例代码和已安装制品。源码搜索无旧符号不代表旧 dist 已移除，发布制品也要检查。

这些路径是起点，不是迁移白名单。实施时搜索整个 Pluxel 工作区及 vendor 内的 import、wrapper、测试 mock、生成模板和依赖接线，逐项归入编辑决策、需关闭结算的资源或普通组件行为。大规模迁移只覆盖本次契约的真实消费链；不把所有 useEffect 改为 content.effect，不顺带升级无关依赖或重写业务服务。`vendor/split-like-vscode` 是独立 Git 子模块，当前根 workspace 也接入其包；核对实际解析入口和构建产物，不能以改了子模块源码代替消费者接入验证。

迁移前 Pluxel 的 unregisterResource 是 detach，不能直接改名为 stop。原有 activation disposer 末尾的 detach 调用必须删除或改到真正的所有者边界，防止 cleanup 再调用自己的 stop。仅由新 effect 确实替代的 closed、mounts、disposing 逻辑可以删除；业务结果代次和共享会话所有权仍需逐项核对。

接口替换与全部已知调用方迁移必须在同一可交付批次完成。最终不留旧入口别名、deprecated shim、版本开关或两套教程；变更按实际破坏性记录 Tegami，由发布工具处理版本。

## 7. R5：修正当前事实，保留历史验收

实施前[架构入口](README.md) 仍说 Pluxel 本体未迁移，而当时的 [WorkspaceSession](https://github.com/PluxelJS/pluxel/blob/5161c68007cec611b73ded9a6eb435ebf9449f83/packages/workbench/shell/src/app/workbench/session.tsx) 已使用 createWorkbench。本次已更新 Shell/Studio 接入事实，过渡说明归入有日期的历史记录；旧验收的范围不改写为今天的证明。

公开 README 现在只展示这一套默认用法，资源专题解释 signal/defer、晚到结果和协议边界。实施前“提案”状态和旧验收是历史记录，不代表当前导出状态。

## 8. 实施顺序与验收

先独立修复 R2，形成明确回归。随后将 R1、R3、必要的 R4 及所有消费者迁移作为一个完整 API 替换批次，避免新资源通道已经上线、错误报告仍走旧规则。R5 与对应批次同步。

| 验收场景                            | 必须观察到的结果                                                   |
| ----------------------------------- | ------------------------------------------------------------------ |
| 编辑回调随渲染更新                  | 不需 useMemo；读取最新已提交状态；丢弃的 render 不影响 owner       |
| owner 撤回、重新登记、业务身份替换  | 对象更新不重登；撤回/重登使旧批准失效；A/B 同 revision 不串批准    |
| 一个编辑 owner、多个子组件 effect   | 只有一份关闭决策；每份资源独立结算；第二编辑 owner 明确拒绝        |
| A 路由切到 B，A 的 RPC 晚到         | A 的 signal 已失效；defer 释放 A；不更新 B、不附着到仍存续的 tab   |
| setup 获取一项资源后抛错            | 已登记资源被释放，setup 错误可见；不依赖成功 return 才获得 cleanup |
| stop、关闭、shutdown 交错           | 每次登记只释放一次；关闭等待已知清理；没有自身等待环               |
| 慢清理期间与关闭返回后分别晚到      | 截取后资源均释放，不延长既定等待集合，错误独立可见                 |
| abort listener / cleanup 重入       | stop 无重复；defer 按晚到规则释放；不漏清理或错误                  |
| 关闭被拒绝、取消、修订失效          | effect 和资源保持；原来的批准不能越过新编辑                        |
| 关闭后同 id 重开                    | 旧 content handle 无法启动 effect；旧上下文晚到 defer 只清理旧资源 |
| StrictMode 重放、后台、原生移动     | 重放允许新获取且无遗留；普通后台和移动不重建 effect                |
| 根 owner + Activity/Suspense 子区域 | 隐藏期间仍拒绝 dirty 关闭；资源按 React cleanup/重建，无第二 owner |
| 清理失败和延迟清理                  | 其他资源继续释放；错误进入对应回执或 onIssue，不重复提示           |
| React stop 后 close 接管清理        | 接管前未报告的错误只进回执；已报告错误不重放；UI 入口消费回执      |
| 报告器缺省或同步抛错                | 有默认诊断；不阻断其他清理，不导致结算回执丢失                     |
| 允许/拒绝 ADD 预检                  | save/change 均为 0，新 tab 未插入；真正 snapshot 保留保存事件      |
| 删除旧公开面                        | 源码、声明、dist、独立消费者和当前文档只呈现新入口                 |

用拟议类型先检查普通编辑器和 Cap’n Web 示例的调用表达，再以真实实现跑 lifecycle/关闭回归、独立打包消费者类型与构建、最短浏览器路径。新模型的测试应保护资源释放和编辑决策，不继续断言已删除的微任务保留机制。

Cap’n Web 示例用真实库的隔离 RPC 会话验证 target disposal、重复引用和晚到结果；只有承诺网络断开行为时才增加 WebSocket 断连验证。Pluxel 实施时验证一个真实 View/Content 的打开、拒绝关闭、成功关闭与错误报告，按宿主 HMR 和控制台流程操作。Studio 同步验证 retain/release、共享草稿和保存保护，不因视图清理丢弃业务修改。

### 实施前证据与历史审查边界

- 前轮 R2 探针已复现预检触发 save；`layout-policy.test.ts`、`resolved-tools.test.ts` 的现有 **20 项通过**，但没有覆盖该缺口。
- 前轮现行资源示例类型检查及生命周期相关 **27 项回归通过**，均不是新 API 的验收。
- 2026-10-30 记录：以文中拟议声明检查普通编辑器、订阅和真实 Cap’n Web 类型示例，严格类型检查通过，四项旧入口/旧字段不可用的类型断言通过。这验证调用形状，不证明 React 或资源释放的运行行为。
- 2026-11-01 设计复核：补齐关闭等待集合、错误报告归属、React 隐藏支持边界和迁移验收；公开签名不变。该次历史审查仅改设计稿，未实现或验证这些运行行为，前述通过数不构成本版时序契约的验收。后续实施和新证据单列于[本轮实施验收](API_REFINEMENT_VALIDATION.md)。

实施完成需同时满足：全部已知调用方采用新入口；只删除已由新契约承担的通用生命周期代码；公开导出、文档、源码解析与打包制品一致；上述行为有实际证据。只完成库内实现、调用形状类型检查或文本替换均不算完成。

不扩展为查询框架、自动重连、任务中心、多个编辑 owner、嵌套 scope 树或新的布局引擎。无需改变独立 SplitView、其他原生能力和无关公共方法。
