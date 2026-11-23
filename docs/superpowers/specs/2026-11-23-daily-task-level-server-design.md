# 每日任务与关卡（服务端闭环）设计

> 状态：已确认，待实现。  
> 依据：`word-camp-development-v1.1.md` §4.1/§5/§9/§10.3/§16，`docs/WORD_CAMP_HANDOFF.md` §8 P0。  
> 本次范围：服务端核心闭环。学生 UI、教师看板、真实音频、错词重练不在本次内。

## 1. 目标

让学生每天拿到一份冻结的“新词 + 到期复习”任务，按 L1/L2/L3/L5/Boss/复习关卡作答。服务端负责出题、判分、幂等提交、重试与提示、星级、FSRS 调度和奖励结算。

## 2. 数据模型

新增一次迁移 `daily_study_tasks`：

### DailyStudyTask

- `id`
- `enrollmentId` + `studyDate`（Asia/Shanghai `YYYY-MM-DD`）唯一
- `status`：`ACTIVE | COMPLETED | EXPIRED`
- `version`：任务版本，奖励事件键使用
- `newWordTarget`、`reviewTarget`
- `config Json`：关卡列表、通关率、听音降级策略等，创建后冻结
- `createdAt`、`completedAt`

### DailyTaskWord

- `taskId`、`cardInstanceId`、`cardId`
- `kind`：`NEW | REVIEW`
- `sortOrder`
- 快照：`word`、`pos`、`definitionL2`、`definitionL1`、`variants[]`、`exampleSentence`
- 唯一 `(taskId, cardInstanceId)`

### LevelSession

- `taskId`、`level`（`L1 | L2 | L3 | L5 | BOSS | REVIEW`）、`attemptNo`
- `state`：`IN_PROGRESS | COMPLETED`
- `sessionVersion`
- `questionCount`、`firstTryCorrect`、`eventuallyCorrect`
- `stars`、`cleared`
- `startedAt`、`endedAt`
- 唯一 `(taskId, level, attemptNo)`；进行中会话复用以实现幂等开始

### LevelQuestion

- `sessionId`、`taskWordId`
- `questionType`：`L2 | L3 | L5 | BOSS`
- 题目快照：`prompt`、`pos`
- `options Json`：仅选项文本，正确项不通过接口下发
- `correctAnswer`、`acceptedAnswers[]`：仅服务端使用
- `sortOrder`
- `attemptsUsed`、`hintLevel`、`firstTryCorrect`、`eventuallyCorrect`、`answerRevealed`、`answeredAt`

### LevelAnswer

- `sessionId`、`questionId`
- `submissionId`：唯一 `(sessionId, submissionId)`
- `answer`、`correct`、`attemptNo`、`hintLevel`、`responseMs`、`answeredAt`

旧 `ReviewSession`/`ReviewEvent` 保持不动。

## 3. 任务生成与冻结

`GET /api/students/task/today?enrollmentId=`：

1. 按上海学习日计算 `studyDate`。
2. 取或建 `DailyStudyTask`；并发冲突由唯一键兜底后重读。
3. 新词：deck 中 `state = NEW`，默认取 10 个，按 Assignment 优先级、再按 createdAt。
4. 复习：已到期 `LEARNING/REVIEW/RELEARNING`，默认取 10 个，按 due 升序。
5. 把卡片内容写入 `DailyTaskWord` 快照。
6. 返回任务、词数、各关卡状态与星级、每日完成标记。

任务创建后词表不再变化。词库编辑不影响已生成任务。

## 4. 关卡会话与判分

### 开始

`POST /api/students/levels/start`：

- 已有进行中会话：原样返回题目与进度。
- L1：词卡预览，无题目。
- L2/L3/L5：每个新词一道题。
- BOSS：每个新词一道混合客观题（按序号轮换 L2/L3/L5）。
- REVIEW：每个复习词一道混合客观题。
- L4：无音频，记录为等价题降级，不创建会话、不阻塞通关。
- 题目与选项在会话创建时写库，刷新不变。

### 提交

`POST /api/students/levels/:id/answer`：

- 请求含 `questionId`、`answer`、`submissionId`、`responseMs`。
- 相同 `submissionId` 直接返回已存结果，不新增答题、不重复计数。
- 每题最多 3 次：前两次错误返回 `retryAllowed: true`；第 3 次错误返回正确答案并结束该题。
- 判分使用共享 `judgeSpelling`/`normalizeSpelling`；拼写提示差一字符时返回“很接近了”。
- 单题结果只记录首答/最终正确、提示级别，不触发 FSRS。

### 提示

`POST /api/students/levels/:id/hint`：

- 拼写：0 → 首字母，1 → 逐字母，最多两级。
- 选择题：排除一个错误选项。
- 提示级别写入题目，用于结算评分。

### 结算

`POST /api/students/levels/:id/complete`：

- 所有题目已结束（或 L1 已查看）才可结算。
- 星级用共享 `computeLevelStars`：基础关 70%、Boss 80%；首答 90%/100% 得 2/3 星。
- 未通关标记 `cleared = false`，允许开新一轮（`attemptNo + 1`）。
- 通关后每个词只调度一次：`selectSchedulingAnswer`（拼写优先，否则 L3）→ `rateAnswerAttempt` → FSRS `schedule` → 更新 `CardInstance`。
- BOSS 首次通关结算 `boss_clear`；新词成功调度结算 `word_learned`；复习词成功调度结算当日 `review_ok`。
- 新词部分（L1/L2/L3/L5/BOSS 全部通关）与复习部分（复习题全部答完）满足后，结算 `daily_done:{studyDate}` 并把任务置为 `COMPLETED`。
- 奖励全部走 `settleRewardsForUser`，数据库唯一键保证重复请求不重复发奖。

## 5. API 清单

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/students/task/today?enrollmentId=` | 取或建今日任务 |
| `POST /api/students/levels/start` | 开始/继续关卡 |
| `GET /api/students/levels/:id` | 恢复关卡与题目进度 |
| `POST /api/students/levels/:id/answer` | 幂等提交答案 |
| `POST /api/students/levels/:id/hint` | 请求提示 |
| `POST /api/students/levels/:id/complete` | 结算关卡、调度与奖励 |

## 6. 测试与验证

- 单元/服务测试：任务取建幂等、快照冻结、选项确定性与答案不外泄、重试/揭晓状态机、提示级别、星级、调度只一次、奖励键与重复提交、每日完成判定。
- 回归：`npm run test -w server` 全量、三包构建、干净库迁移。
- Docker 端到端：完成 L2/L3/L5/BOSS/REVIEW，核对星级、`boss_clear`、`daily_done`、重复提交不重复计数。

## 7. 明确不做

- 学生端任务/关卡页面。
- 教师端“今日任务完成/未完成”名单。
- 真实听力音频与 L4 题。
- 错词本与错词重练。
- 教师自定义词数、通关率、关卡配置 UI。
- FSRS 权重拟合。
