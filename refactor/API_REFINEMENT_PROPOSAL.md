# Worksplit 内容 API 设计决策

2026-11-01 复核的内容 API 已实施，Worksplit 与 Pluxel Shell、Report Template Studio 的已知消费者已迁移。
本页只保留设计理由；已完成的迁移过程由 Git 历史保存。

| 要查的事实                                      | 权威入口                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 公开 API、编辑决策和命令                        | [README](../README.md#content-decisions-commands-and-resources)与[公开 exports](../packages/react/src/index.ts) |
| 资源所有权、关闭等待、错误报告及 React 隐藏边界 | [内容资源契约](../docs/resource-lifetimes.md)                                                                   |
| 模块分工及应用接入边界                          | [架构与维护约束](README.md)                                                                                     |
| 本次验收、实际制品、在线证据及未验证范围        | [实施验收](API_REFINEMENT_VALIDATION.md)                                                                        |

## 编辑决策与资源各有寿命

`useWorkbenchContent(lifecycle?)` 声明编辑决策或借用稳定的 content handle；`content.effect(setup)`
把一次资源使用接入内容关闭结算。两者分开，使根编辑 owner 能持续保护修改，子组件按 React 依赖释放和重建自己的资源。
应用已有的业务身份、修订、共享草稿和协议释放顺序仍有独立职责，不能随资源登记层一起删除。

effect 只承担调用方原先重复实现的使用期限、晚到资源释放和清理错误归属。
React 继续管理依赖与组件挂载，原生 Promise、AbortSignal 和 SDK 表达异步及协议行为；
组件局部逻辑继续使用普通 effect，共享资源由应用 owner 持有。
这不需要查询缓存、任务框架、通用 scope 树、公开 ownerId 或另一套业务版本系统。

## 结算边界和报告责任明确

关闭使用固定的已知清理集合，避免尚未完成的获取或不断晚到的资源无限扩张一次操作的等待范围。
清理任务的等待者和报告责任分别归属，避免程序回执与宿主通知重复报告同一失败；不靠全局错误去重缓存补救。
完整时序、默认报告器、晚到错误和无超时保证由[资源结算契约](../docs/resource-lifetimes.md#stop-close-and-error-ownership)维护。
RPC 的取消、共享引用和远端释放回执继续服从[原生协议边界](../docs/resource-lifetimes.md#protocol-release-remains-explicit)。

## React 提交与编辑 owner 分开

最新回调只在 commit 后更新，丢弃的 render 不能改写生效中的关闭决策。
回调提交与 owner 登记分开，避免 Suspense 清理 layout effect 时撤销持续根 owner 的编辑保护。
不保留旧的微任务重放协议；StrictMode 重新 setup 就重新获取该次资源。
隐藏子区域与整个 owner 停用的区别，以及支持的根 owner 组合，统一由[资源所有者与 React 边界](../docs/resource-lifetimes.md#choose-the-owner)说明。

## 布局预检不触发真实保存

FlexLayout 0.11.1 的 `Model.toJson()` 会触发真实 tab 的 save listener，不能用于只读预检。
工具接纳的 policy 需要完整配置及默认继承；为拓扑限制裁剪的候选不能直接代替它。

上游没有无副作用读取完整显式 global 输入的公共方法，因此 Worksplit 保留初始 global JSON 及原生
`UPDATE_MODEL_ATTRIBUTES` 对它的显式更新；root、borders 和节点配置从真实 Model 的纯节点数据读取。
这些输入只用于短寿命原生候选，仍由原生 Action 判断接纳，不建立第二份长期布局或公共 clone API。
正式 snapshot 保留原生 save 行为。可复现缺陷及允许、拒绝、默认继承和 global 更新回归见[实施验收](API_REFINEMENT_VALIDATION.md)。
