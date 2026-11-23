# 版本管理与发布规范

> 适用范围：单词特训营（Word Camp）项目。
> 目标：每次交付可复现、可回滚、能明确对应到开发规格阶段与上游提交。

## 1. 上游基准

| 项目 | 值 |
| --- | --- |
| 上游仓库 | `https://github.com/jpasden/vanilla-class-srs.git` |
| 固定提交 | `4fcbf6d4eb6aaacbfc23144a948f1c4dd9e6f065` |
| 本地标签 | `baseline-4fcbf6d` |
| 许可证 | MIT（见根目录 `LICENSE`） |

上游提交**不随上游 `main` 自动更新**。需要升级基准时，单独开任务：拉取新提交 → 跑完整测试与集成用例 → 记录差异 → 在新分支合并，并在 `docs/UPSTREAM_SYNC.md` 写清变更。禁止直接在旧基准上 `git pull` 造成不可追溯的历史。

## 2. 分支

| 分支 | 用途 | 规则 |
| --- | --- | --- |
| `main` | 可交付 / 可演示的集成分支 | 只接受来自 `develop/*` 或 `feature/*` 的合并；每个合并点打标签 |
| `develop/word-camp-v0.1` | 当前阶段开发主线 | 小步提交；每个提交必须通过 `npm test -w server` 与三包构建 |
| `feature/<name>` | 单一特性（登录改造、导入编码、奖励流水等） | 从 `develop` 拉出，完成后合回；冲突文件不跨人并行修改 |
| `fix/<name>` | 缺陷修复 | 必须附复现用例 |

提交信息采用 Conventional Commits 的简化形式，正文用中文说明“做了什么、为什么、验证了什么”：

```text
feat(login): 学生用户名登录与可选邮箱
fix(import): 识别 GBK 编码并拒绝静默乱码导入
docs(stage0): 记录上游审计结论与 Go/No-Go
test(rewards): 覆盖每日上限与事件键去重
chore(release): v0.2.0 阶段 1 基线
```

## 3. 版本号

采用语义化版本，但含义按本项目调整：

| 版本位 | 含义 |
| --- | --- |
| 主版本 `1.x` | 达到规格 §16 的 MVP 验收清单并通过试点；学生端可日常使用 |
| 次版本 `0.x` | 规格阶段交付：`0.1` 阶段 0 基线、`0.2` 班级与词库、`0.3` 学生学习、`0.4` 激励与学情、`1.0` 试点交付 |
| 修订号 | 兼容性修复、文档、测试与依赖更新 |

预发布阶段统一使用 `0.x.y`，不得把尚未通过验收的能力标为 `1.0.0`。当前版本见根目录 `VERSION`。

## 4. 标签与变更记录

- 每个阶段结束打附注标签：`v0.1.0-stage0`、`v0.2.0-stage1`……
- `main` 上的每个标签必须同时更新 `CHANGELOG.md`，写清新增 / 变更 / 修复 / 验证 / 已知限制。
- 标签只增不改；发现标签内容有误时，打新标签并在变更记录中说明撤销原因。

## 5. 提交前检查（每个提交）

```powershell
npm run test -w server
npm run build -w shared
npm run build -w server
npm run build -w client
git diff --check
```

涉及数据库时，额外在一次性 PostgreSQL 库上执行：

```powershell
npx prisma migrate deploy --schema=prisma/schema.prisma
$env:SL_TEST_DATABASE_URL = $env:DATABASE_URL
npx vitest run src/__tests__/subjectLead.integration.test.ts --root server
```

集成套件有硬性保护：数据库主机必须是 `127.0.0.1`，库名必须是 `sl_fresh`（防止误用开发库）。本机 Compose 的 `db` 不映射宿主端口时，用一个临时 TCP 代理即可：

```powershell
# 1) 临时把容器 db:5432 映射到 127.0.0.1:5433
docker run -d --rm --name wc-dbproxy --network wordcamp_default -p 127.0.0.1:5433:5432 `
  alpine/socat tcp-listen:5432,fork,reuseaddr tcp:db:5432

# 2) 建库并在容器内跑全部迁移
docker exec wordcamp-db-1 psql -U srs_user -d postgres -c 'DROP DATABASE IF EXISTS sl_fresh;' -c 'CREATE DATABASE sl_fresh;'
docker run --rm --network wordcamp_default -e "DATABASE_URL=$containerUrl" wordcamp-migrate

# 3) 宿主上跑测试（URL 必须是 127.0.0.1:5433/sl_fresh）
$env:DATABASE_URL = "postgresql://srs_user:<password>@127.0.0.1:5433/sl_fresh"
$env:SL_TEST_DATABASE_URL = $env:DATABASE_URL
npm run test -w server -- --run src/__tests__/subjectLead.integration.test.ts

# 4) 清理代理；sl_fresh 可保留或 DROP
docker rm -f wc-dbproxy
```

2026-11-23 用上述流程得到 12/12 通过；该结果不等同于完整的资源级权限矩阵。

## 6. 提交粒度与回滚

- 一个提交只做一件事；文档与代码可以同提交，但不得把“格式化全仓”与业务改动混在一起。
- 每个阶段至少有一个**可回滚点**：数据库迁移只追加、不就地改写历史迁移；回滚通过新迁移或恢复备份完成，不删历史迁移。
- 破坏性变更（删除字段、改变判分、改变奖励事件键）必须单独提交，并在 `CHANGELOG.md` 标注“需人工确认”。

## 7. 远程与推送

当前仓库没有配置 `origin` 远程，版本记录只在本地。新增远程时先确认目标仓库与权限，再把 `main` 推送到该远程；不要推送到 `upstream`（上游仓库只用于拉取基准）。如果配置了远程，每个会话结束前按仓库约定提交，但**推送前必须人工确认**目标。

## 8. 许可证与第三方素材

- 保留上游 MIT `LICENSE` 与版权声明；本项目新增代码沿用同一许可证，除非后续单独决定。
- 依赖许可证清单见 `docs/THIRD_PARTY_LICENSES.md`；新增依赖必须记录名称、版本、许可证与用途。
- 词典、例句、图片、发音音频必须逐项记录来源和授权状态，授权不明的素材不得进入发布分支。
- GPL-3.0 项目（TypeWords、Qwerty Learner）只借鉴交互思路，不复制代码；确需复用前先评估对许可证与分发方式的影响。

## 9. 环境与数据

- 开发、测试、生产三套环境分离；生产数据不得用于开发测试。
- `.env` 与任何真实密钥不提交；仓库内只保留 `.env.example` 模板。
- 数据库备份与恢复演练记录归入 `docs/`，与代码标签对应。
