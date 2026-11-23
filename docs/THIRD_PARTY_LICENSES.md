# 第三方许可证与素材清单

> 生成方式：`node scripts/license-report.js`（只读 `package-lock.json`，不联网、不安装）。
> 基线日期：2026-11-23。新增或升级依赖后必须重新生成本表。

## 1. 项目与上游

| 对象 | 许可证 | 说明 |
| --- | --- | --- |
| Vanilla Class SRS `4fcbf6d` | MIT | 本仓库的基础代码；保留根目录 `LICENSE` 与版权声明 |
| 单词特训营新增代码 | 沿用 MIT | 除非后续单独决定并记录 |

GPL-3.0 项目（TypeWords、Qwerty Learner）只借鉴交互与产品思路，**不复制其代码**。Habitica、ClassQuiz、Vocabulary Trainer 等仅作为参考；引入任何代码前先评估许可证兼容性。

## 2. 直接依赖

| 工作区 | 包 | 声明范围 | 锁定版本 | 许可证 |
| --- | --- | --- | --- | --- |
| root | `@prisma/client` | ^5.22.0 | 5.22.0 | Apache-2.0 |
| root | `prisma`（开发） | ^5.22.0 | 5.22.0 | Apache-2.0 |
| root | `concurrently`（开发） | ^8.2.2 | 8.2.2 | MIT |
| server | `bcrypt` | ^5.1.1 | 5.1.1 | MIT |
| server | `cookie-parser` | ^1.4.7 | 1.4.7 | MIT |
| server | `cors` | ^2.8.5 | 2.8.6 | MIT |
| server | `csv-parse` | ^5.5.6 | 5.6.0 | MIT |
| server | `dotenv` | ^17.3.1 | 17.3.1 | BSD-2-Clause |
| server | `express` | ^4.21.1 | 4.22.1 | MIT |
| server | `express-rate-limit` | ^8.6.2 | 8.6.2 | MIT |
| server | `jsonwebtoken` | ^9.0.2 | 9.0.3 | MIT |
| server | `multer` | ^1.4.5-lts.1 | 1.4.5-lts.2 | MIT（已弃用 1.x，见 §4） |
| server | `nodemailer` | ^6.9.16 | 6.10.1 | MIT-0 |
| server | `zod` | ^3.23.8 | 3.25.76 | MIT |
| server | `typescript`（开发） | ^5.6.3 | 5.9.3 | Apache-2.0 |
| server | `tsx`（开发） | ^4.19.2 | 4.21.0 | MIT |
| server | `vitest`（开发） | ^4.1.6 | 4.1.6 | MIT |
| client | `react` / `react-dom` | ^18.3.1 | 18.3.1 | MIT |
| client | `react-router-dom` | ^6.28.0 | 6.30.3 | MIT |
| client | `vite`（开发） | ^5.4.10 | 5.4.21 | MIT |
| client | `@vitejs/plugin-react`（开发） | ^4.3.3 | 4.7.0 | MIT |
| client | `typescript`（开发） | ^5.6.3 | 5.9.3 | Apache-2.0 |

`@vanilla-srs/*` 为仓库内工作区包，私有，不单独分发。

### 类型声明包

`@types/bcrypt`、`@types/cookie-parser`、`@types/cors`、`@types/express`、`@types/jsonwebtoken`、`@types/multer`、`@types/node`、`@types/nodemailer`、`@types/react`、`@types/react-dom` 均为 MIT 或 Apache-2.0 类型声明，仅构建期使用。

## 3. 传递依赖许可证分布

| 许可证 | 包数量 | 备注 |
| --- | ---: | --- |
| MIT | 347 | 宽松，保留版权声明即可 |
| ISC | 42 | 宽松 |
| Apache-2.0 | 13 | 宽松，需保留 NOTICE（若有） |
| MPL-2.0 | 12 | `lightningcss` 及其平台二进制；文件级 copyleft，未修改时按原许可证分发 |
| BSD-3-Clause | 4 | 宽松 |
| BSD-2-Clause | 2 | 宽松 |
| CC-BY-4.0 | 1 | `caniuse-lite` 数据；仅构建期 |
| MIT-0 | 1 | 无署名要求 |
| 0BSD | 1 | 无署名要求 |
| UNKNOWN | 3 | `busboy`、`streamsearch`、`spawn-command` 的 `package.json` 无 license 字段，但各自附带 MIT 风格 LICENSE 文件；分发时保留其 LICENSE |

## 4. 安全与升级提示

- 在 Docker 构建（官方 npm registry）中，完整 `npm ci` 报告 **21 个漏洞（1 low / 5 moderate / 12 high / 3 critical）**；生产依赖审计（`npm audit --omit=dev`）报告 **15 个：2 critical、7 high、6 moderate**，主要来源：
  - `proxy-addr`（critical，IPv4-mapped IPv6 信任网段导致 IP 伪造；影响依赖 `X-Forwarded-For` 的限流与审计）；
  - `tar`（critical，解压 / 解析 DoS 与路径穿越；由 `@mapbox/node-pre-gyp` → `bcrypt` 引入）；
  - `nodemailer`（high，地址解析递归 / 二次复杂度 DoS，以及禁用文件访问绕过）；
  - `bcrypt`、`body-parser`、`qs`、`zod`、`path-to-regexp`（high / moderate）；
  - `csv-parse`（moderate，原型替换；升级到 7.x 为破坏性变更）；
  - `react-router` / `react-router-dom` / `@remix-run/router`（moderate，开放重定向）。
- 处理顺序建议：先升级 `express` / `proxy-addr` / `body-parser` / `qs` 与 `nodemailer`（不改变业务 API），再评估 `bcrypt` 6 与 `zod` 4 的兼容性；`csv-parse` 7 与导入改造一起做。升级后必须重新跑单元测试、权限集成测试与构建，并更新本清单。
- 当前宿主 npm 镜像不支持 `npm audit` 端点；本地审计命令：
  ```powershell
  docker run --rm -v "${PWD}:/app" -w /app node:22-alpine npm audit --omit=dev
  ```
- 已弃用：`multer@1.4.5`（官方提示 1.x 存在漏洞，建议升级 2.x）、`tar@6.2.1`、`glob@7.2.3`、`rimraf@3.0.2`、`npmlog@5.0.1`、`gauge@3.0.2`、`are-we-there-yet@2.0.0`、`inflight@1.0.6`。升级前需回归上传、导入与 Prisma 工具链。
- 升级依赖必须同步更新 `package-lock.json` 与本清单，并在 `CHANGELOG.md` 记录。

## 5. 字体、图片与音频素材（未完成授权确认）

| 素材 | 位置 | 当前状态 |
| --- | --- | --- |
| Fredoka、Nunito、Nunito Italic、Pacifico 字体 | `client/public/fonts/*.woff2` | 仓库未附字体许可证文件；上线前必须确认来源与授权（多为 SIL OFL，但需以实际来源为准），并保留许可证 |
| Vanilla Class SRS 标题、卡片、卡组图片与 favicon | `client/public/*.png`、`*.ico` | 来自上游 MIT 仓库，保留上游版权声明；若替换为自有品牌素材，需记录新素材来源 |
| 单词发音音频 | 尚未引入 | 规格 §7.6 要求预生成音频并逐条记录来源 / 授权；授权不明不得上线 |
| 词典释义、例句、图片 | 尚未引入 | 由教师审核并提供；上线前记录来源与授权 |

**规范要求：** 中文字体不通过网络加载；音频单条约 30 KB 以内；无音频 / 图片时学习流程仍可完成。
