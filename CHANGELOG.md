# 变更记录

本项目变更记录从上游基准 `4fcbf6d` 之后开始。格式参考 Keep a Changelog，日期使用 Asia/Shanghai。

## [Unreleased]

### 计划中
- 学生用户名登录、可选邮箱、会话撤销与公共电脑选项。
- 词表导入编码探测（UTF-8 / BOM / GBK）与 `variants` 字段。
- Docker 部署链路修复（迁移、管理员种子、workspace 清单）。
- 每日任务、关卡、奖励流水、反馈入口与移动端学生界面。

## [0.1.0-stage0] - 2026-11-23

### 新增
- 引入 `word-camp-development-v1.1.md` 开发规格。
- 阶段 0 技术验证记录：`docs/WORD_CAMP_STAGE0_VERIFICATION.md`。
- 版本管理与发布规范：`docs/WORD_CAMP_VERSIONING.md`。
- 第三方许可证清单：`docs/THIRD_PARTY_LICENSES.md`。
- 纯规则层 `shared/word-camp.ts` 与 `server/src/__tests__/wordCampRules.test.ts`：拼写判分 / 变体 / 接近提示、FSRS 评分映射、上海学习日期、掌握状态、关卡星级、等级阈值、奖励事件键与每日上限结算；80 个单元测试。

### 验证
- `npm ci` 安装 329 个包。
- `npm run test -w server`：208 通过、12 跳过。
- `npm run build -w shared|server|client`：通过；学生端产物 gzip 111.00 kB。
- 9 个 Prisma 迁移在 PostgreSQL 16 上全部应用。
- `subjectLead.integration.test.ts` 在一次性 PostgreSQL 库上 12/12 通过。

### 已知限制
- 上游 FSRS 实现未达规格：复习稳定度公式缺项、遗忘曲线为近似、到期日依赖服务器本地时区；本版本不宣称间隔复习正确。
- 上游部署链路未跑通：Compose 数据库地址与镜像内迁移 / 种子缺失；Dockerfile workspace 清单需修复。
- 词表导入不支持 GBK，`variants` 字段尚不存在。
- 用户名登录、每日任务、奖励流水、反馈、移动端界面均未实现。
- 无真机 / 微信内置浏览器验证，无域名、备案与合规确认。
- 依赖审计未完成（当前 npm 镜像不支持 audit 端点）。生产依赖审计（官方 registry）发现 15 个漏洞：2 critical、7 high、6 moderate，升级计划见 `docs/THIRD_PARTY_LICENSES.md` §4。

## 上游基线

- `baseline-4fcbf6d` - 2026-11-23 - 固定 Vanilla Class SRS `4fcbf6d4eb6aaacbfc23144a948f1c4dd9e6f065`。
