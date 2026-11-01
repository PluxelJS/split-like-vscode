# Worksplit API 精进实施与验收（2026-11-01）

本记录对应 [2026-11-01 复核契约](API_REFINEMENT_PROPOSAL.md)，不沿用实施前的通过数。
当前公开用法由 [README](../README.md) 和[资源契约](../docs/resource-lifetimes.md)维护。

## 实施与迁移范围

- Worksplit：统一 `useWorkbenchContent(lifecycle?)`、`content.effect(setup)` 和 `signal/defer`；
  删除旧 lifecycle hook、命令式 register、lifecycle disposer 和 React 重放保留层。
  `DispatchResult` 为公开类型。一个编辑 owner 与多个独立资源 effect 分别管理自己的寿命。
- 关闭：批准并原生移除后，先截取所有 closing content 的已知清理及先前 stop 尚未完成的清理，
  再通知应用代码。各 effect 并发结算，内部按获取的逆序释放。setup Promise 和晚到资源不延长集合。
  程序回执、原生 UI 消费与无人接管的异步错误分别只有一个报告所有者。
- Pluxel Shell：document/session、View/Content runtime 与 panel 接线全部迁移；删除文档资源 Set、
  registerResource/detach、activation 挂载计数和重放保留。保留编辑身份修订、远程业务代次、
  跨内容共享 session，以及 Bridge → host facade → RPC handle 的协议释放顺序。
- Studio：File/Form/Preview 的页面引用由 content effect 释放；共享草稿、retain/release、保存 CAS
  与业务生命周期工厂继续由 workspace 持有。关闭修订显式包含项目 id/root、path 和 kind。
- demo、独立 tarball fixture、类型负例、所有已知相关测试/mock、公开用法及工程入口同步迁移。
  全工作区模板、示例和插件搜索未发现额外旧入口调用；保留的旧符号仅为历史迁移说明和负向断言。
  根 workspace 纳入 demo 并补齐其 tooling catalog，使用根现有依赖，解决嵌套 React/Router 身份冲突。

## 可复现缺陷与最小修正

1. R2 先增加允许/拒绝 ADD 的回归，均以 live `save=1` 失败，再修为 `save=0/change=0`；
   真正 snapshot 仍触发一次 save。工具候选保留显式 global 输入和原生 global 更新，
   root/borders/config 读取纯节点数据；Shell policy 使用相同的无副作用边界。
2. 原生节点已移除、React 尚未完成卸载时，SDK 清理可能再次查询文档。查询此时返回 `null`，
   不再因缺失节点读取 `getId()`；真实 SDK 集成和清理期间查询回归覆盖该路径。
3. effect cleanup 同步触发 dispose 时，先前实现会重复释放 Router、重复归属同一错误。
   现在先撤回已关闭 session，并在 Router 释放前取走所有权；原生移除观察者重入也覆盖。
4. 已冻结等待集合后，A 的 abort listener 向尚未 stop 的 B `defer`，先前实现会把慢的 late
   cleanup 插在 known cleanup 之前。现在关闭准备本身就是晚到边界；同内容及跨内容回归都在
   late gate 尚未放行时观察 known cleanup 和 close 已完成，晚到失败另行只报告一次。
5. 实际 Host 浏览器启动在 Node `fileURLToPath` 处失败。模块图追踪证实 Management 的 Host/Vault
   及 Shell Host 类型使用了保留模块求值的 inline type import。改为 `import type` 后，实际 Shell
   sourcemap 不再包含 Node Host application/shared-packages，保持原类型与协议而不添加浏览器 shim。
6. Studio 桌面重开项目时，初始化的第二次 refresh 后默认报表会覆盖已经完成或仍在加载的显式选择。
   两项真实 Worksplit 回归先复现失败，再通过 session 私有的“已请求文档”事实限制默认选择。
   此事实只负责启动选择；没有扩展公开 API 或资源代次框架。桌面脚本同时等待指定报表的选中状态。
7. 实际 HTTP 导航在 Shell 重建后仍返回首次 manifest 的旧 chunk 名，而资源 handler 读取当前磁盘，
   形成旧 HTML 的 200 与其脚本的 404。新增回归在同一 handler 上先复现，再改为每次导航读取并校验
   同一目录的当前 manifest；构造时仍提前校验，无效替换明确失败，不回退旧 HTML。
8. Studio 普通退出被仍然 dirty 的共享草稿否决。诊断确认 retain 引用仍在，保存、编译和 body lock
   均已空闲：保存期间编译推进 inputToken，成功保存留下更新草稿，却没有继续的 autosave。
   新回归复现有/无 body lease 的时序；成功保存后仅为仍可保存的更新草稿安排既有 timer，
   保留新 CAS 版本，不同步递归，不重试失败或冲突。已有后续保存占用队列时不再安排 timer，
   避免较早调用替后续失败保存启动第三次写入。普通桌面退出先有界等待全部草稿结算。

## 隔离与浏览器验收

| 范围                  | 本轮结果                                                                   | 命令或测试入口                                                                                                          |
| --------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Worksplit React       | 27 文件，299 项通过                                                        | `packages/react`: `mise exec -- vp test run --maxWorkers=2`                                                             |
| Worksplit core        | 5 项通过                                                                   | `packages/core`: 同上                                                                                                   |
| React/core/demo 类型  | 全部通过                                                                   | 各包 `mise exec -- tsc -p tsconfig.json --noEmit`                                                                       |
| registered consumer   | 通过                                                                       | React 包 `mise exec -- tsc -p tsconfig.registered-consumer.json --noEmit`                                               |
| Shell                 | 65 文件，398 项通过                                                        | Pluxel 根 `node node_modules/vitest/vitest.mjs run --config packages/workbench/shell/vitest.config.ts --maxWorkers=2`   |
| Shell HTTP/manifest   | 9 项通过                                                                   | Pluxel 根 `node node_modules/vitest/vitest.mjs run packages/workbench/tests/shell.test.ts --maxWorkers=2`               |
| Management 浏览器边界 | 3 文件，22 项通过                                                          | `management-validation`、`portable-management-client`、`runtime-session-client`                                         |
| Studio 相关回归       | 4 文件，80 项通过                                                          | `workbench-session`、`workspace-ui`、`input-recovery`、`panes-lifecycle`                                                |
| demo Chromium         | 44 项通过                                                                  | vendor 根 `WORKSPLIT_URL=http://127.0.0.1:5188 node node_modules/@playwright/test/cli.js test`，复用 Pitchfork 托管服务 |
| 独立 tarball consumer | 默认/development runtime 与声明、Vite 生产构建全部通过；Chromium 29 项通过 | vendor 根 `mise exec -- node scripts/check-package-consumer.mjs --browser`                                              |
| Studio 生产 runtime   | 通过                                                                       | Studio 根 `node tests/runtime.mjs`；两个外部客户端、保留会话、重启、IPC 与清理                                          |
| Host 真实浏览器       | 24 项通过；页面错误和资源失败均为空                                        | Pluxel `projects/plugin-host/dev/workbench.browser.mjs`；完整参数与 receipt 见在线验收                                  |
| Studio 真实 Electron  | 24 项完整桌面验收通过，进程退出 0                                          | Studio `tests/desktop.mjs`，宿主 Xvfb + x11；完整命令和环境边界见下文                                                   |

提案第 8 节的关键时序分别由以下真实实现测试覆盖：

| 契约                                                                                | 回归入口                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 最新已提交回调、丢弃渲染、owner 撤回/替换、重复 owner                               | `lifecycle-replay.test.tsx`                                                                            |
| StrictMode 重新获取、持续根 owner + Activity/Suspense 子区隐藏                      | `lifecycle-replay.test.tsx`、`lifecycle-suspense.test.tsx`；Shell `workbench-close-lifecycle.test.tsx` |
| 逆序/并发、setup 失败、晚到清理、精确取消原因、stop 接管                            | `content-effects.test.ts`                                                                              |
| 拒绝关闭不停止、失效 handle、同 id 重开、回执归属、原生 UI 去重、缺省/抛错 reporter | `content-effect-integration.test.tsx`                                                                  |
| close/dispose 重入与跨 effect/content 晚到清理                                      | `content-close-reentrancy.test.ts`                                                                     |
| 真正 Cap’n Web 重复引用、A 晚于 B、关闭后晚到 RPC target 释放                       | `content-capnweb.test.ts`（真实 MessageChannel 会话）                                                  |
| 真实 View/Content SDK、晚到旧 RPC、不更新新页面、释放顺序/失败归属                  | Shell `workbench-native-activation.test.tsx`、`workbench-content-activation.test.tsx`                  |
| 共享草稿 retain/release、拒绝保存仍保留资源、同 token 的项目/path/kind 身份替换     | Studio `panes-lifecycle.test.tsx`、`workbench-session.test.tsx`                                        |
| 允许/拒绝预检零 save/change、snapshot save、默认继承和 global 更新                  | `resolved-tools.test.ts`、布局 policy 测试；Shell `workbench-plugin-panels.test.tsx`                   |

tarball 验收只安装打包文件，未借用源码；两种解析条件都落公开 dist，旧 hook 不导出，
旧 register/dispose/track/return-disposer 在类型用例中明确拒绝。浏览器报告位于
`test-results/packed-consumer/packed-consumer-results.json`，本轮 `pageErrors=[]/consoleErrors=[]`。
开发 StrictMode 观察四次 setup、两次重放 cleanup，拒绝关闭计数不变；成功 close 再释放一次，
dispose 最后释放一次，重复 dispose 不增加释放，最终 subscriptions/liveRouters 都为零。

嵌套 Pluxel 安装环境中，vendor 原注册 demo 服务尝试使用独立工具链的 `vp 1.2`，与根的
Vite+ 1.4 不匹配而未启动。本轮不升级这套独立工具链；通过 Pitchfork 原生 `run` 托管根命令
`./node_modules/.bin/vp run @worksplit/demo#dev:server`，在 5188 端口对同一 demo 执行上述 44 项验收。
这项失败尝试没有遗留进程，原注册项保留 errored 诊断；不能将根环境的通过表述为该原命令通过。

## 实际制品与解析

本轮顺序运行 Pluxel 根的 `@worksplit/react#compile`、`@pluxel/workbench#compile`、
`@report-template-studio/app#compile`、`@worksplit/demo#compile` 和 `@pluxel/cli#compile`，均成功。
库 dist sourcemap 的 integration/workbench/content-effects 三项与当前源码逐字相等。

最终根目录 `vp check` 覆盖全部 27 个改动代码文件，格式、lint 和类型相关检查无警告或错误；
React/core/demo、registered consumer、Shell、Workbench 与 Studio 的独立 TypeScript 检查均通过。
根仓库及 vendor 的 `git diff --check` 通过。最终 lint 命名调整后重跑 Shell 两个 activation
测试文件的 17 项回归、Shell 类型检查及 Workbench 构建，全部通过。

Shell 的实际 HTTP 入口与最终 manifest 都引用 `assets/client-Dg_8rT-i.js`，文档 chunk 为
`public/assets/document-DvcWGbfb.js`；对应 sourcemap 的上述三项也与最终源码逐字相等。
Shell `runtime-ZR6W0fym.js.map` 的 activation 源码也与最终源码相等；比对结果保存于
`/tmp/worksplit-final-artifact-identity.json`。Studio 的 `dist/renderer/index.html` 加载
`assets/index-BUiYYCkK.js`，解析 `@worksplit/react` 到同一 vendor dist；该 JS 直接包含最终
关闭、晚到边界、按节点 handle、React 提交/owner 和原生报告去重实现，无旧登记方法。
Studio 没有生成 sourcemap，未声称其全源码逐字相等。

Host 的实际 pack 还补出了 Wretch 已有 TinyBase peer 的发布事实 `pluxel.tinybase=10.0.1`。
只保留该生成字段，不保留工具附带的无关键排序；没有升级其依赖。随后重建 CLI，
`dist/source-fingerprint` 与当前 package manifests 的计算结果相等，最终 `dev status` 成功。

## 在线验收

### Host、HMR 与真实 View/Content

本轮开始时目标服务未运行。启动后，在连续源码修改前对原实例
`fec964b3-6ea2-47ba-a730-48e9e42c2bd6` 执行 `dev hmr pause`，原模式为 auto。
检查和构建后以同一实例执行 apply，原 receipt 的 run
`afee55dd-238d-4fac-8d8f-8d1513d6cbfe` 成功，应用 ready、更新 applied、pending=0。
原始 pause/apply JSON 和 receipt 分别保存在 `/tmp/worksplit-host-pause.*` 与
`/tmp/worksplit-host-apply.*`，没有将 receipt 转投新实例。

HTTP manifest 回归还证实旧进程已导入的 `@pluxel/workbench` 是 Node native external
singleton，既有 Vite 控制台不能替换该模块命名空间。另一次显式 apply 也成功但没有新待处理源码。
因此在完成上述 HMR 验收后，通过 Pitchfork 单独重启该服务以加载重建的 native 库；
没有用重启代替源码 apply。新实例 `2fee2240-0660-4e72-a3e0-65d52961eb3a` 的实际 HTTP
HTML 引用当时的 client/document chunk，检查应用 ready、auto、pending=0，最近更新 applied。

最终 lint 命名调整在该服务已停止时进行。重建 Shell 后再通过 Pitchfork 启动实例
`004b358d-d8e5-4429-bfc0-46dfc441ac67`，以最后的 client chunk 重跑完整浏览器验收。
最终状态保存在 `/tmp/worksplit-host-before-final-stop.json`：ready、auto、pending=0、applied。

最终浏览器命令为：

```sh
node projects/plugin-host/dev/workbench.browser.mjs \
  --origin http://plugin-host.pluxel.localhost:8088 \
  --root /home/ahdg/code/shinium/pluxel/projects/plugin-host \
  --instance 004b358d-d8e5-4429-bfc0-46dfc441ac67 \
  --executable /home/ahdg/.var/app/io.github.trumank.CodeStudio/cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
  --artifacts /tmp/pluxel-workbench-browser-api-script-r11 --lifecycle
```

真实 Chromium 验收 24 项通过，权威结果为
`/tmp/pluxel-workbench-browser-api-script-r11/receipt.json`，`errors=[]/resourceFailures=[]`。
覆盖以下当前发布组件和真实业务行为：

- MF View 连续打开/关闭八次，两个显式副本保留各自草稿和 DOM 身份，owner 数回归。
- `studioStatus` Content 打开、隐藏释放、恢复获取、关闭释放及同一原生 id 重开。
- dirty Bot View 拒绝原生关闭时无错误提示；拒绝命令关闭时只出现一条历史报告和一个 toast；
  批准前保留同一输入和 DOM，批准后卸载，重开确认未改写后端原始内容。
- 通过现有 Vite 控制台 stop/start 真实插件，两份应用报告均成功且无 issues；旧 MF 根销毁后可重新打开。
- 每次真实 document navigation 独立统计 runtime session socket，十次导航均只打开一条，最终活动连接为一条。
  不把 Playwright 导航时清理的旧 WebSocket 对象错误累计为泄漏。
- 分组、pin、原生移动与 resize、后台 draft、独立页面、未知 deep link、损坏 snapshot 显式恢复，
  以及真实 Packages View 的副本和后端不变断言均通过。

结果内保存七份控制台原 receipt，均属于最终实例 `004b358d-d8e5-4429-bfc0-46dfc441ac67`，
host epoch 为 `c66ea4aa-f561-48e2-ad0c-5cc1ca83e200`。该浏览器运行没有注入生产 cleanup 失败；
错误回执与晚到资源归属由 Shell 真实 SDK 集成回归补充证明。
验收完成后本任务启动的 Host 和 demo 已通过 Pitchfork 停止，最终 `dev status` 没有实例。

### Studio 桌面

最终生产制品在 Electron 44.9.0 完整运行 `tests/desktop.mjs`，脚本退出 0，
`result.json` 的 24 项验收全部完成。使用宿主已有 `xvfb-run -d` 原生分配显示，
Chromium 和 GTK 都明确选择 x11；没有替换生产 renderer、`window.confirm` 或 native dialog SDK。
在本次 Flatpak 工作区执行的完整命令为：

```sh
flatpak-spawn --host \
  --directory=/home/ahdg/code/shinium/pluxel/projects/report-template-studio \
  xvfb-run -d \
  -f /home/ahdg/.var/app/io.github.trumank.CodeStudio/tmp/worksplit-studio-desktop-xvfb-final-Xauthority \
  -s '-screen 0 1440x900x24' \
  -e /home/ahdg/.var/app/io.github.trumank.CodeStudio/tmp/worksplit-studio-desktop-xvfb-final-xvfb.log \
  env STUDIO_OZONE_PLATFORM=x11 GDK_BACKEND=x11 STUDIO_DISABLE_SANDBOX=1 \
  STUDIO_KEEP_PROFILE=1 \
  STUDIO_SCREENSHOTS=/home/ahdg/.var/app/io.github.trumank.CodeStudio/tmp/worksplit-studio-desktop-xvfb-final \
  /home/ahdg/.var/app/io.github.trumank.CodeStudio/home/.local/share/mise/installs/node/24.16.0/bin/node \
  tests/desktop.mjs
```

权威结果位于上述 `STUDIO_SCREENSHOTS` 目录的 `result.json`，同时保存
`draft-recovery.json`、`source-file-views.json`、MessagePort 证据、截图和 Electron 日志。
实际验证共享 body/data 草稿、文件与表单一致保存、CAS 冲突恢复、失败保存后整份报表重载、
原生 docking 与关闭/重开后 assistant 草稿保留、桌面退出/重开后内容与格式保留、
PDF/ZIP 传输和导入，以及普通退出、重复退出等待后端清理并无 shutdown errors。
脚本还检查 renderer 没有未捕获错误；生产 RPC 的结构化失败是另行明确断言的负向用例。

本环境的原生 Wayland 首窗 `SIGSEGV` 和 headless 原生确认框 `SIGTRAP` 均由不含
Studio/Worksplit 的最小 Electron 窗口独立复现；这些环境问题没有被报告为已修复。
最终 Xvfb 路径先通过同 profile 两次启动、原生确认、截图和正常退出探针，再执行完整产品验收。
三组探针分别保存在工作区临时目录的 `worksplit-electron-window-probe-V7Zj6o`、
`worksplit-electron-confirm-probe-vrhjE9` 和 `worksplit-electron-xvfb-probe-foFzGS`。

## 验证边界

- 隔离 RPC 使用真实 Cap’n Web MessageChannel；没有把它描述为 WebSocket 断网保证或远端资源释放回执。
- StrictMode、Activity/Suspense 覆盖持续根 owner 的组合；整个编辑 owner 随外层 Activity 停用时继续发编辑命令仍不支持。
- 浏览器资源计数与 DOM 身份证明本 fixture 的释放行为，不等于 heap leak 或性能结论。
- Studio 完整桌面结论限于上述 Linux Xvfb/x11 环境；没有证明本机 Wayland 或 headless 原生弹窗可用。
- 未运行其他操作系统、打包安装器或无关工作区全量套件；不涉及发布、版本号或 publish-lock 修改。
