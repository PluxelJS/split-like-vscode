# 历史记录入口

旧 API、实施过程、日志与截图通过 Git 追溯；这里不维护第二份现行契约或验收结果。
2026-10-11 的库/独立消费者验收、2026-11-01 的内容 API 精进、2026-11-02 的整合与财务记录，
仅证明各自记录时点；其中 Shell/Studio 的历史接入不代表本轮新契约已经迁移或安装。
本地旧附件归档在父仓库忽略目录 `.artifacts/worksplit-redesign/historical-refactor`，不要求消费者拥有该目录。

仍需保留的反例已落入当前边界与回归：

- 类型注册的封闭 search schema 不能被误当成任意字符串索引；[注册 Router 消费者](../packages/react/consumers/registered-router.ts)独立编译。
- 原生 ADD 后再 DELETE 不保证恢复原布局权重；接纳必须在实际写入前决定，不能靠事后回滚。见[接纳架构](../docs/architecture.md#one-admission-path)。
- 保存成功不等于保存了期间新增编辑；一次清理错误不能向操作调用者和宿主重复报告。见[资源契约](../docs/resource-lifetimes.md)。
- 2026-10-11 的 hash 设计探针曾往返 1,000 个 UUID/45,012 字符片段；它只说明当时原生编码能力，不是当前财务浏览器或生产性能证明。

当前入口：[公开用法与共享实例](../README.md)、[架构](../docs/architecture.md)、
[行为](../docs/vscode-workbench-behavior.md)、[原生支持与移除条件](../docs/navigation-support.md)、
[本轮剩余范围](../docs/proposals/README.md)。新的日志、截图和测量进入忽略的 `test-results/`；财务宿主证据进入父仓库 `.artifacts/`。
