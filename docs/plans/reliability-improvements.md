---
doc-type: plan
status: draft
source-of-truth:
  - ../../src/run/target-lock.ts
  - ../../src/index.ts
  - ../../src/plugins/lock.ts
  - ../../src/plugins/worktree.ts
  - ../../src/plugins/mixer.ts
  - ../../src/run/verify.ts
  - ../../src/run/doctor.ts
  - ../../src/utils/worktree.ts
  - ../../src/plugins/config.ts
  - ../../src/plugins/reload.ts
  - ../../src/cli.ts
  - ../../src/run/merge.ts
  - ../../test/
last-verified: 2026-10-05
review-after: 2026-11-05
---

# vite-plugin-shopify-theme 优化任务

本文面向插件维护者，将 2026-10-05 代码审查发现的五项可靠性问题整理为可独立验证的工程任务。优先处理主题运行互斥和拆包样式完整性，再补齐生产校验、Git 子目录支持与 watcher 范围。

五项修复已于 2026-10-05 在工作树实施，尚未提交；插件打包、`test:package` 与浏览器端样式加载 / HMR 尚未验证。本文不替代[工作区迭代规划](../../../docs/plans/vite-plugin-shopify-theme-roadmap.md)中的外部验收与发布工作；主题 CI 编排另见[主题 CI 可复用工作流方案](theme-ci-workflows.md)。

## 审查基准与证据边界

审查基准为插件提交 `52a10de91aff5f4f51020daf652c06722e4e524b`，核验日期为 2026-10-05。开始与结束审查时，插件工作树均无改动；后续实施前需要重新核对相关代码。

已取得的证据：

- 临时目录交错执行锁创建与记录写入，两个锁申请均返回成功。
- 按插件注册顺序调用生命周期钩子，竞争者被锁拒绝前已设置 Git 的 `skip-worktree` 标志。
- 模拟带静态依赖 CSS 的 bundle，调用 Mixer 生成钩子，依赖 CSS 与间接依赖的预载标签未进入 snippet。
- 临时主题缺少 Mixer 引用的入口资产，且 layout 中的 render 位于 Liquid 注释内，生产校验仍返回通过。
- 临时 Git 仓库内的子目录主题能够查询跟踪状态，但 index 内容读取失败；改用当前目录相对的 index 路径可以正确读取。
- 解析带额外 reload 目录的 Vite 配置，该目录仍出现在 watcher 忽略列表中。
- 类型检查通过；`policies`、`plugins`、`dev-processes`、`verify`、`delegation` 五个测试文件共 26 个测试通过（2026-10-05 复跑一致）。

审查未启动 dev/build、未连接店铺，未运行完整测试套件。拆包结论来自模拟 bundle 与源码核对，watcher 结论来自配置解析；实际构建中的 CSS 加载、文件监听与浏览器 HMR 仍需实施时验证。

## 推荐实施顺序

| 任务                | 建议优先级 | 交付行为                                           |
| ------------------- | ---------- | -------------------------------------------------- |
| T1 运行锁与启动顺序 | 高         | 同一主题只有一个运行者，竞争失败不改写主题或 Git   |
| T2 静态依赖样式收集 | 高         | 拆包后的首屏静态依赖样式完整加载                   |
| T3 生产校验完整性   | 中         | 缺失生成资产或无效 Mixer 引用阻止交付              |
| T4 Git 子目录主题   | 中         | dev、restore、doctor 读取目标主题的正确 index 内容 |
| T5 watcher 范围     | 中         | 显式 reload 目录与相关源码变更保持可监听           |

T4 与 T5 的已确认触发条件在本工作区不出现：工作区主题均为各自 Git 仓库的根目录，宿主 [Vite 配置](../../../vite.config.ts)关闭了插件 reload（核验日期 2026-10-05）。两项影响的是 npm 包的外部使用者，实施时必须用独立 fixture 复现，不能以工作区主题运行正常作为通过依据。

各任务可以独立修复和回归，推荐顺序为 T1 → T2 → T3 → T4 → T5。T2 与 T3 完成后联合核验生成引用与资产存在性；T1 与 T4 完成后联合核验启动失败对 Git 的影响。

## T1 修复运行锁竞争与启动副作用

**问题与影响。** 首次创建锁文件与写入 owner 记录之间存在窗口，读取失败会被当作可恢复的旧锁，竞争者可能删除仍在创建中的锁。直接运行 Vite 的路径还会在取得锁前修改 Git 标志，破坏同目标互斥的副作用边界。前两项均已通过临时目录或钩子交错执行复现。

实施位置：[目标锁](../../src/run/target-lock.ts)、[插件注册顺序](../../src/index.ts)、[锁插件](../../src/plugins/lock.ts)、[Git 生命周期插件](../../src/plugins/worktree.ts)、[只读诊断](../../src/run/doctor.ts)。

推荐改动：

- 锁记录先完整写入同目录的临时文件，再以 `link` 原子发布到锁路径；目标已存在时同样返回 `EEXIST`，锁文件一经出现即为完整记录，消除「已创建未写入」窗口。
- 只有合法记录且确认 owner 进程已退出时，才进入自动恢复。改为原子发布后，损坏记录只来自外部篡改或磁盘异常，此时阻止运行并提供定位信息；doctor 对同一状态给出一致诊断，不执行修复。
- Git 生命周期插件的只读校验保持在取锁之前，`skip-worktree` 写入移入 `configureServer` 返回的 post hook，晚于全部普通钩子（含取锁）执行；竞争者在任何主题或 Git 写入前被拒绝，校验失败时也不占锁。
- 落选方案：把锁插件注册到 Git 生命周期插件之前。Vite 逐个调用 `configureServer` 且不通知后续钩子失败，校验失败时锁会在同一进程内泄漏，已由 Mixer 生命周期测试复现。

落选方案：保留「先创建空文件再写入」，并把不完整记录判为阻止运行。进程在创建与写入之间被强杀时会留下永久空锁，后续每次运行都需要人工删除，属于把竞争问题转成可用性问题。

- 保留合法旧锁的串行恢复和按 token 释放语义，避免误删新 owner 的锁。

验收标准：

- 在临时记录写入与发布之间设置确定性暂停点，第二个申请不能误判旧锁，锁路径不出现不完整记录；补充真实多进程竞争验证，不能仅靠重复运行碰概率。
- 进程中断遗留的临时文件不阻塞后续申请，也不被误认为锁。
- 空记录、损坏记录、存活 owner、已退出 owner、遗留 recovery guard 均有明确且一致的结果。
- 同一主题的第二次启动失败时，snippet、layout 内容与 Git index 标志保持申请前状态。
- 后续启动钩子失败后，锁能被下一次合法运行取得；不同主题仍可并行。
- CLI 持有的外层锁与直接 Vite 路径继续互斥，doctor 保持只读。

回归入口：[锁测试](../../test/target-lock.test.ts)、[Runtime 测试](../../test/runtime.test.ts)、[Mixer 生命周期测试](../../test/mixer-lifecycle.test.ts)、[CLI 测试](../../test/cli.test.ts)。

## T2 补齐静态依赖样式与预载收集

**问题与影响。** Mixer 生成钩子未递归收集静态依赖的 CSS。模拟 bundle 已证明这类元数据会被遗漏；真实拆包后可能造成样式缺失，具体构建与浏览器表现待验证。[Vite 后端集成文档](https://vite.dev/guide/backend-integration)要求递归收集静态依赖 CSS，并允许递归预载静态 JavaScript 依赖，核验日期为 2026-10-05。

实施位置：[Mixer 生成](../../src/plugins/mixer.ts)。

推荐改动：从入口递归遍历静态依赖，使用访问集合处理共享依赖和环，分别去重 CSS 与预载标签。保持可重复的输出顺序，样式先于入口脚本；动态依赖继续按需加载。

验收标准：

- 入口 → vendor → shared 的多层静态依赖带 CSS 时，所需样式均进入 snippet，且每个引用只出现一次。
- 菱形共享依赖与循环依赖不会重复输出或无限递归；相同 bundle 多次生成结果一致。
- 动态 chunk 与其 CSS 不提前进入首屏 snippet，仍按需加载。
- 实际拆包 fixture 的 CSS 文件、snippet 引用和加载结果一致；未拆包场景保持正确。

回归入口：[拆包测试](../../test/splitting.test.ts)、[Mixer 生命周期测试](../../test/mixer-lifecycle.test.ts)。实际构建验证尚未执行，不能用模拟 bundle 结果代替。

## T3 加强生产校验与引用识别

**问题与影响。** 生产形态标记和引用字符串不能证明资产存在或 render 实际可执行。缺失入口资产、注释内 render 的组合已在临时主题中通过现有校验，可能让不能加载生成资源的主题进入后续交付。

实施位置：[生产校验](../../src/run/verify.ts)、[Mixer 注入](../../src/plugins/mixer.ts)、[doctor](../../src/run/doctor.ts)、[CLI 编排](../../src/cli.ts)。

推荐改动：

- 核验 Mixer snippet 中 `asset_url` 引用的脚本、样式和预载资产在主题 `assets/` 中存在，不新增 manifest 中转文件。
- 不解析 JS import 图核对动态 chunk：校验与构建在同一锁内顺序执行，资产缺失只可能来自命名或清理缺陷，snippet 引用核对已覆盖首屏依赖；动态 chunk 图核对成本高、增益小。
- 让 Mixer 注入、doctor 与生产校验共用 render 识别逻辑，排除 Liquid 注释和 raw 等非执行文本。
- 保留合法条件分支内的引用；识别引用不等于证明它在所有请求中执行，完整 Liquid 控制流分析不纳入本任务。
- 校验失败包含目标文件或缺失资产，且 CLI 不继续调用上传或打包。

验收标准：

- 缺失入口 JS、CSS 或预载 chunk 时，生产校验失败；完整资产集合通过。
- 仅在 comment 或 raw 中出现 render 时，不能算有效引用；合法条件引用通过且不被重复注入。
- Mixer 注入、doctor、生产校验对同一 layout fixture 给出一致判断。
- 校验失败时，CLI adapter 验证 Shopify 上传与打包调用均未发生。

回归入口：[生产校验测试](../../test/verify.test.ts)、[CLI 测试](../../test/cli.test.ts)、[Mixer 生命周期测试](../../test/mixer-lifecycle.test.ts)。

## T4 修复 Git 子目录主题的 index 读取

**问题与影响。** 跟踪状态查询与 index 内容读取使用不同的路径基准。主题位于 Git 仓库子目录时，跟踪状态查询成功而内容读取失败，影响开发启动、恢复与诊断。临时仓库已复现。

生成文件冲突合并存在同一根因：冲突路径来自相对当前目录的 `ls-files` 输出，而判断 HEAD 中是否存在该文件时按仓库根解析树路径。子目录主题下判断必然失败，已跟踪的生成文件会被 `git rm` 删除而非检出 HEAD 版本。该结论由源码与 Git 路径解析规则推得，尚未复现。

实施位置：[Git 操作核](../../src/utils/worktree.ts)，同步复核其调用方：[开发生命周期](../../src/plugins/worktree.ts)、[恢复入口](../../src/cli.ts)、[doctor](../../src/run/doctor.ts)、[生成文件合并](../../src/run/merge.ts)。

推荐改动：在 Git 操作核中统一目标路径的解析基准，index 与 HEAD 树路径均使用当前目录相对写法（`:./` 前缀）；合并流程复用同一解析方式。不要求主题根必须是 Git 仓库根，也不在调用方各自修补。

验收标准：

- 仓库根主题、仓库子目录主题与 linked worktree 均读取正确的 indexed production Mixer。
- 仓库根与子目录同时存在同名 snippet 时，读取及恢复只作用于目标主题。
- dev、restore、doctor、merge 对子目录主题运行正确；restore 保持原有 Git 标志语义。
- 子目录主题合并出现生成文件冲突时，HEAD 已有的生成文件被检出保留，仅 HEAD 不存在的生成文件被移除。
- 无 Git 的主题继续采用非 Git 路径，不误操作其他仓库。

回归入口：[CLI 测试](../../test/cli.test.ts)、[Mixer 生命周期测试](../../test/mixer-lifecycle.test.ts)、[Git 策略测试](../../test/policies.test.ts)。

## T5 协调 watcher 裁剪与 reload 范围

**问题与影响。** 配置解析已确认：显式额外 reload 目录会与插件生成的忽略范围冲突。入口目录外的公共依赖也可能受到同类裁剪影响，但其实际 HMR 表现尚未验证。

实施位置：[配置与 watch 范围](../../src/plugins/config.ts)、[reload 监听](../../src/plugins/reload.ts)。

推荐改动：

- 把显式 reload 目录纳入保留范围。继续复用 Vite watcher，保持无关参考主题的目录裁剪收益。
- 用入口目录外、root 顶层的公共源码 fixture 判定依赖监听行为：其变更在当前裁剪下无法触发 HMR 时，停止按入口顶层目录裁剪，仅忽略 root 下其他 Theme Target 目录（判据执行前先验证）；能触发时保持现有裁剪，只补回归测试。

验收标准：

- Vite root 内外的显式 reload 目录均不被插件忽略；变更事件触发预期刷新。
- 静态导入与动态导入的公共源码变更能够被监听；已进入模块图的文件走 HMR，不额外触发整页刷新。
- 无关参考主题继续被排除；关闭插件 reload 时，Vite 自身的模块 HMR 正常。
- root 即主题根、入口在 root 顶层、路径边界相近的目录均有覆盖。

回归入口：[Runtime 配置测试](../../test/runtime.test.ts)、[reload 钩子测试](../../test/plugins.test.ts)、[reload 策略测试](../../test/policies.test.ts)。文件事件与浏览器 HMR 需要运行态证据，配置断言不能替代。

## 实施范围与最终验收

修复范围为插件源码、受行为变更影响的既有测试和相关文档。工作区项目状态为 `beta`，按共享代码规则不新增自动化测试，各项验收以一次性脚本取证。保留现有 CLI、Runtime 与插件职责边界，锁修复不改变 dev 退出后保留开发形态与 Git 标志的约定。

公共行为变更需要评估工作区接入主题：theme-daisy、theme-dev、theme-frame 与只读的 shopify-theme-hbada；不得修改只读参考主题。真实主题验证优先使用 theme-dev，不把真实店铺作为自动化测试 fixture。

按项目约定，未取得明确请求时不启动 dev/build。实施时先执行不涉及这些生命周期的验证；构建、服务器启动、浏览器 HMR 和实际主题集成验证取得相应授权后再执行。任一必需验证未执行时，记录剩余检查及原因，不能宣布整个任务完成。

最终交付应满足：

- 五项任务的验收场景均有证据，并区分静态检查、钩子模拟、真实多进程、构建和浏览器结果。
- [包脚本](../../package.json)与[CI](../../.github/workflows/ci.yml)要求的检查通过；发布包验证覆盖实际分发入口。
- 必要的文档更新与源码同批评审，不改变主题 ID、远程发布配置或只读参考主题。
- 验收后按文档生命周期收尾本文；长期保留的内容仅限有决策价值的取舍与验证结论，不维护实现镜像。
