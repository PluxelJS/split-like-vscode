# Worksplit API 与资源生命周期精进提案

状态：提案，尚未实现。日期：2026-10-30。审查基线：Worksplit `755cbe1` 及当前工作区调用方。

**内容接入统一到 `useWorkbenchContent()`：在 hook 参数中声明编辑决策，通过返回的 `content.effect()` 管理资源。** React 继续管理依赖和组件挂载；Worksplit 负责把每次 effect 的资源接入内容关闭结算。

这是一次替换：迁移全部已知调用方后删除旧 lifecycle hook、命令式 register 和应用自建资源登记层，不保留兼容 alias。不新增上一版提出的 `registerResource()`。本文只维护这一套目标设计；现行公开文档在实现前继续描述现行 API。

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

## 2. R1：以 content 为唯一接入对象

### 2.1 拟议公开契约

以下声明是目标设计，尚未导出；`WorkbenchLeaveContext` 沿用现有契约。

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

- 无参数调用只取得 content，不占用编辑决策 owner；传入 lifecycle 对象则声明该 hook 是 owner。一个 content 仍只允许一个编辑 owner。
- lifecycle 保留已有业务回调名，删除 `dispose`。回调读取最新已提交渲染中的状态，调用方无需为登记身份写 `useMemo`/`useCallback`。
- 返回对象在同一 content 实例中稳定；不同组件可以各自调用 `content.effect()`，不竞争编辑 owner。
- `effect` 在调用时执行 setup，先登记所有权再运行应用代码；它应从原生 `useEffect` 或明确的事件处理启动，不在 render 中调用。
- `effect` 返回一个幂等的同步 stop 函数，可直接作为 React cleanup。异步清理由 Worksplit 跟踪，调用方无需再写 `void release().catch(...)`。
- setup 中只用 `defer` 登记清理，不再同时支持返回 disposer、`use(resource)`、`track(promise)` 等同义路径。上下文只包含 signal 和 defer，不可创建嵌套 scope。

`useWorkbenchContent(lifecycle)` 在 commit 后接入 owner，并更新回调，不能在 render 中改写已生效的注册。被丢弃的并发渲染不得改变关闭行为。现有 lifecycle 的动态 getter 仍在使用时读取，不提前拍平成快照。

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

### 2.4 每次 effect 的寿命与结束行为

资源属于一次 `content.effect()`，而不是一个可被反复借用的全局 tab 资源袋。这解决“同一 tab 已从 A 路由变成 B，A 的资源却晚到”的问题。

| 触发                                      | 行为                                                               |
| ----------------------------------------- | ------------------------------------------------------------------ |
| React 依赖变化或组件卸载                  | stop 立即使本次 signal 失效，开始清理；下一次 setup 获得全新上下文 |
| 关闭被拒绝或取消                          | 不停止 effect，资源继续可用                                        |
| 内容正式移除或实例 dispose                | 同步停止所属 effects，再结算已知清理                               |
| tab 激活、后台、原生移动或 Border 收起    | 没有实际组件卸载就保持 effect                                      |
| setup 中途失败                            | 停止本次 effect，清理已经 defer 的资源，报告真实错误               |
| setup 结束后仍存续                        | 资源继续有效，直到 stop 或内容结束；setup 完成不等于释放           |
| stop 后异步资源才返回                     | 旧上下文的 defer 立即清理它；不能登记到新路由或同 id 重开的 tab    |
| 重复 stop、React cleanup 与关闭交错       | 每次 defer 登记只执行一次 cleanup                                  |
| 旧 content handle 在内容移除后调用 effect | 在执行 setup 前明确拒绝；不创建资源，不附着到新实例                |

同一 effect 的已登记资源按获取的逆序逐项清理，失败后继续后续清理。不同 effect 之间没有依赖顺序；相关的订阅和 capability 放在同一 effect。结束后才登记的资源立即清理，不追溯此前顺序。

signal 表示本次使用期限结束。它可传给支持取消的原生 API，也可在 await 后检查；不能据此宣称远端调用已取消。仅与本次 signal.reason 对应的受控取消可按正常结束处理，不能因为 signal 已失效就吞掉其他错误。

### 2.5 关闭完成与 React 重放

`close`/实例 `dispose` 等待已经登记以及正在进行的 cleanup；不自动等待任意尚未完成的 setup Promise。晚到资源仍释放，晚到错误走 `onIssue`，已返回的关闭回执不追溯改变。必须等待业务任务退出时，把等待放进 defer 的清理函数，沿用该业务的取消/超时约定。

stop 返回 void 是为了直接符合 React cleanup。它只启动结束流程，不是远端清理完成回执。需要等待整体结束的宿主使用既有 `close`/`dispose`；不新增每个 effect 的 wait、drain 或状态订阅 API。

按 [React effect 契约](https://react.dev/reference/react/useEffect)，StrictMode 可以执行 setup → cleanup → setup。新设计允许重新获取资源，并保证第一次 setup 的晚到结果被清理。删除旧 hook 的微任务“保留同一注册”协议，不承诺开发期只连接一次。必须跨 React 重挂载保留的共享会话提升到宿主 owner，页面只持有自己的引用或订阅。

编辑决策 owner 与 resource effect 独立：普通 rerender 更新回调不重建资源；owner 真正替换才使旧关闭批准失效。关闭仍核对 owner、内容版本和业务修订，不能因回调指针变化而让每次输入都重建登记，也不能因 owner 对象稳定就跳过修订复核。

owner 身份来自 hook 挂载实例。若同一组件原地换成另一份业务编辑器，业务修订必须能区分资源身份，或通过 React key 明确重挂载；不能把两个编辑器各自的 `revision = 0` 当作同一批准。Pluxel 已有的编辑 owner 修订组合仍应保留。

### 2.6 为什么这次范围足够

每次 effect 拥有 signal、清理集合和结束状态，承担了现有调用方反复手写的真实职责。它不返回加载数据、不缓存查询、不重试、不决定后台任务策略，也不提供通用插件或 scope 树。

只需组件局部清理且无需参与 Worksplit 关闭结算的逻辑，继续用普通 React effect。独立 async 流程也继续使用原生 Promise、AbortSignal 和 SDK，不要求整页所有代码迁入 content.effect。

## 3. R2：预检应避免触发真实 tab 的保存回调

### 已确认的路径

[integration.ts](../packages/react/src/integration.ts) 的 `allowToolAdmission()` 在存在 `allowDrop` 时调用 `Model.fromJson(model.toJson())` 构造候选；公开 `canDispatch()` 会走到这里。

FlexLayout 的序列化会触发 tab 的 `save` 回调，见[上游事件文档](https://github.com/caplin/FlexLayout#tab-node-events)。已有 [layout-policy.ts](../packages/react/src/layout-policy.ts) 已专门避免在拓扑预检中调用真实 `Model.toJson()`，但工具接纳路径尚未遵守同一边界。

本次只读隔离探针使用公开 `createWorkbench`、原生 Actions，以及 `layoutPolicy.allows` 提供的 Model：

1. 创建一个已有工具 tab 和一个待加入工具，配置 `allowDrop: () => true`。
2. 在已有 tab 上安装 `save` 计数器，只调用一次 `canDispatch(ADD_TAB)`。
3. 检查真实 Model 是否变化，随后释放 Worksplit 实例。

结果：预检返回 `true`，`save` **1 次**，Model change **0 次**，新 tab **未插入**，实例释放错误 **0 个**。执行前核对了构建 sourcemap 内的 `integration.ts` 与当前源码完全一致。

这证明预检会触发保存回调；没有据此声称发生文件写入或数据丢失。

### 最小修复方向

工具接纳候选应通过不触发真实 save listener 的原生节点数据创建。先核对现有 `topologyCandidate` 能保留哪些信息；它为拓扑检查裁剪过语义，不能直接当作任意布局克隆工具复用。需要保留实际 policy 读取的配置、默认继承和目标信息，并继续由原生 Model 执行候选 Action。

仅在两处所需语义一致时合并私有 helper；不增加公共 `cloneModel` 或第二份长期布局。正式 `snapshot()`/序列化仍保留原生 save 行为。

Pluxel 的 `panelLayoutPolicy.allowsAction()` 同样使用真实 `model.toJson()`，应作为已知调用方一起核对。不能只修库内路径后就宣称所有自定义 policy 都无副作用。

## 4. R3：让回执与错误报告各负其责

当前 `closeAction()` 返回 `failed`/`cleanupErrors` 的同时调用 `onIssue`。Pluxel 的 `onIssue` 和 `WorkspaceSession.check()` 都会展示错误，代码路径存在重复通知的可能；本次未运行在线 UI 验证通知次数。

建议按错误接收方划分责任：

- 程序调用 `close`/`dispatch`：操作结果由返回回执承担，调用方决定提示和后续动作。
- 原生 UI 发起、没有外部 await 的操作：React/原生入口消费同一个回执，再转给 `onIssue`。
- 路由后台工作、无等待者的注销清理、成功操作之外的附带清理失败：保留 `onIssue`，不能因主操作成功就吞掉错误。

这会改变现有通知行为，必须同步检查 demo、独立消费者、Pluxel 和所有依赖 `onIssue` 的测试。不要直接删除 `closeAction` 中的上报，也不要添加全局错误去重缓存。

无等待者的错误必须有默认可见结果：保留 `onIssue` 为可选宿主处理器，未提供时由库统一 `console.error` 报告；提供时只调用宿主处理器。当前可选回调缺省后不报告的行为应随本批修正，避免新的 effect 接口捕获失败后静默丢弃。页面不必逐个 effect 重复安装相同 catch。

同时导出有明确用途的 `DispatchResult`，先表达现有联合类型，供消费者替代手写 `{ status: 'applied' | 'rejected' }` 拼接。保留当前 discriminated results；不把全部 API 改成一个 Result 包，也不统一同步布尔查询和异步操作的返回形状。

`dispatch` 的普通拒绝目前没有 `reason`。这是诊断能力的限制，但目前核对的消费者仅需通用提示；本轮不为每个内部条件新增错误码。出现真实程序分支需求时，再为该分支补稳定原因及运行时证据。

## 5. R4：内部只维护一条清理路径

现有 [integration.ts](../packages/react/src/integration.ts) 约 2,173 行，行数不是拆分依据。此次只收敛与新契约有关的两项职责：

- React binding：维护稳定 content handle、commit 后的最新编辑回调和唯一 owner 身份；不再维护旧 `PendingLifecycle`、`takePendingLifecycle`、`deferLifecycle` 重放接线。
- 私有 effect 结算模块：维护每次 setup 的 signal、defer 列表、单次结束与正在结算的任务；依赖变化、错误、关闭和 shutdown 都调用同一路径。

Worksplit 协调实例继续决定接纳、原生移除、关闭批准和回执。Router、MRU、焦点、浏览器历史保留原所有者。旧 lifecycle.dispose 和新 effect 清理不能各自保留一套 registry；旧 cleanup 状态迁入唯一结算路径后删除。

setup 没有直接等待者，其失败通过 onIssue 报告。cleanup 在关闭结算内失败时进入关闭回执；普通 React stop、晚到资源清理等没有操作回执的路径进入 onIssue。两条结束路径争用同一任务时只确定一处报告责任，不引入全局错误去重缓存。调用方未处理业务错误不能被伪装成取消。

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

Pluxel 当前 unregisterResource 是 detach，不能直接改名为 stop。原有 activation disposer 末尾的 detach 调用必须删除或改到真正的所有者边界，防止 cleanup 再调用自己的 stop。仅由新 effect 确实替代的 closed、mounts、disposing 逻辑可以删除；业务结果代次和共享会话所有权仍需逐项核对。

接口替换与全部已知调用方迁移必须在同一可交付批次完成。最终不留旧入口别名、deprecated shim、版本开关或两套教程；变更按实际破坏性记录 Tegami，由发布工具处理版本。

## 7. R5：修正当前事实，保留历史验收

[架构入口](README.md) 仍说 Pluxel 本体未迁移，当前 [WorkspaceSession](https://github.com/PluxelJS/pluxel/blob/5161c68007cec611b73ded9a6eb435ebf9449f83/packages/workbench/shell/src/app/workbench/session.tsx) 已使用 createWorkbench。更新当前接入事实，过渡说明归入有日期的历史记录；旧验收的范围不改写为今天的证明。

新 API 实现后，公开 README 只展示这一套默认用法，资源专题解释 signal/defer、晚到结果和协议边界。本文在实施前保持“提案”状态，不能让读者误以为目标签名已可导入。

## 8. 实施顺序与验收

先独立修复 R2，形成明确回归。随后将 R1、R3、必要的 R4 及所有消费者迁移作为一个完整 API 替换批次，避免新资源通道已经上线、错误报告仍走旧规则。R5 与对应批次同步。

| 验收场景                          | 必须观察到的结果                                                   |
| --------------------------------- | ------------------------------------------------------------------ |
| 编辑回调随渲染更新                | 不需 useMemo；读取最新已提交状态；丢弃的 render 不影响 owner       |
| 一个编辑 owner、多个子组件 effect | 只有一份关闭决策；每份资源独立结算；第二编辑 owner 明确拒绝        |
| A 路由切到 B，A 的 RPC 晚到       | A 的 signal 已失效；defer 释放 A；不更新 B、不附着到仍存续的 tab   |
| setup 获取一项资源后抛错          | 已登记资源被释放，setup 错误可见；不依赖成功 return 才获得 cleanup |
| stop、关闭、shutdown 交错         | 每次登记只释放一次；关闭等待已知清理；没有自身等待环               |
| 关闭被拒绝、取消、修订失效        | effect 和资源保持；原来的批准不能越过新编辑                        |
| 关闭后同 id 重开                  | 旧 content handle 无法启动 effect；旧上下文晚到 defer 只清理旧资源 |
| StrictMode 重放、后台、原生移动   | 重放允许新获取且无遗留；普通后台和移动不重建 effect                |
| 清理失败和延迟清理                | 其他资源继续释放；错误进入对应回执或 onIssue，不重复提示           |
| 允许/拒绝 ADD 预检                | save/change 均为 0，新 tab 未插入；真正 snapshot 保留保存事件      |
| 删除旧公开面                      | 源码、声明、dist、独立消费者和当前文档只呈现新入口                 |

用拟议类型先检查普通编辑器和 Cap’n Web 示例的调用表达，再以真实实现跑 lifecycle/关闭回归、独立打包消费者类型与构建、最短浏览器路径。新模型的测试应保护资源释放和编辑决策，不继续断言已删除的微任务保留机制。

Cap’n Web 示例用真实库的隔离 RPC 会话验证 target disposal、重复引用和晚到结果；只有承诺网络断开行为时才增加 WebSocket 断连验证。Pluxel 实施时验证一个真实 View/Content 的打开、拒绝关闭、成功关闭与错误报告，按宿主 HMR 和控制台流程操作。Studio 同步验证 retain/release、共享草稿和保存保护，不因视图清理丢弃业务修改。

### 已有证据与本轮边界

- 前轮 R2 探针已复现预检触发 save；`layout-policy.test.ts`、`resolved-tools.test.ts` 的现有 **20 项通过**，但没有覆盖该缺口。
- 前轮现行资源示例类型检查及生命周期相关 **27 项回归通过**，均不是新 API 的验收。
- 本轮以文中拟议声明检查普通编辑器、订阅和真实 Cap’n Web 类型示例：严格类型检查通过，四项旧入口/旧字段不可用的类型断言通过。这验证调用形状，不证明 React 或资源释放的运行行为；新实现仍需完成上面的验收。
- 此次不实现运行时、不迁移消费者、不发布制品。实施完成标准是消费者只需一个 Worksplit hook，资源通过原生 useEffect 接入，旧入口和手写通用生命周期层已被删除。

不扩展为查询框架、自动重连、任务中心、多个编辑 owner、嵌套 scope 树或新的布局引擎。无需改变独立 SplitView、其他原生能力和无关公共方法。
