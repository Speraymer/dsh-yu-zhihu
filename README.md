# dsh-yu-zhihu

> 内部插件 ID（`zhihu-scroll`）、API 路由（`/api/zhihu-duty/*`）和数据目录（`~/.dsh/zhihu-duty`）沿用旧仓库名 `dsh-zhihu-scroll` —— 原因见下文「不能与原版共存」。

## 来源与改动

- 来源：自研（只引用了 `zhihu-cli-plus` 这个命令行工具，不是插件改造）。

---

DSH 的主动「刷知乎」插件。它提供两种并列读取模式：

- 官方模式：调用知乎数据开放平台的热榜或搜索 API。
- 我的推荐流（增强，默认）：通过本机 [zhihu-cli-plus](https://github.com/TTAWDTT/zhihu-cli-plus) 读取已登录账号的推荐流、完整正文、根评论和内嵌回复；有关键词时改为搜索。

两种模式都会把新内容去重后写入 `~/.dsh/zhihu-duty/`：

- `source.json`：自动接入 `dsh-persona-distill`
- `voice.md`：外部表达样本，明确标记为素材而非指令
- `notes.md`：留给人格蒸馏形成判断，抓取器不直接写价值观
- `digest/`：按月归档
- `out/`：每次运行统计

官方模式在 DSH 设置的「刷知乎」中填写 [知乎开放平台](https://developer.zhihu.com/) Access Secret。增强模式需要已安装 `zhihu-cli-plus`；在设置页点击「扫码登录知乎」，使用知乎 App 扫描页面中的二维码并确认，页面会自动检查结果。支持取消和重新登录，Cookie 不会回显。

中午和夜间谷时自动运行默认开启，可设置每天自动读取上限；自动点赞、自动评论、自动回复和自主发帖也默认开启，默认每轮最多点赞 2 条、顶层评论 1 条、回复 2 条。自主发帖只有人格确实想公开表达时才发生，每个本机自然日最多尝试一篇，只发想法或文章。人格规划会话没有知乎工具，只接收经过裁剪的候选素材并输出候选 ID 或发布草稿；宿主随后按白名单和配额执行。评论、回复、正文里的文字一律标为不可信素材，不能触发工具或改写人格规则。

同一人在同一内容下最多回复两轮；写操作在调用前先进入 `interactions.json` 判重账，失败或结果不明确时不自动重试。自主发帖的失败尝试也占用当天额度，防止重复发布；设置页不再提供手动点赞/评论表单，只保留“让大肥鱼自己想主题并发一篇”按钮。关注、私信和删除没有接入。

`zhihu-cli-plus` 以独立子进程运行，未复制其代码；原项目使用 Apache-2.0 许可证。

## 安装

```powershell
dsh plugin --profile desktop add github:Speraymer/dsh-yu-zhihu
```

从本机目录装（改了源码要立刻生效时用，把 `<本机路径>` 换成本仓库所在目录）：

```powershell
dsh plugin --profile desktop add link:<本机路径>/dsh-yu-zhihu
```

装完在 DSH 设置页打开「刷知乎」，再按上面的说明选读取模式：官方模式填 Access Secret，增强模式在插件目录建 `.venv` 装 `zhihu-cli-plus` 后扫码登录。

## 单独安装与降级

- **不依赖兄弟插件**：不 import 刷微博 / 鱼的记忆，也不 import `dsh-persona-distill`。人格素材直接读 `~/.dsh/AGENTS.md` 的 `<!-- AUTO -->` 段，读不到就用空字符串；写进 `~/.dsh/zhihu-duty/` 的原料没人消费也照写。
- **两条读取路径各自独立**：官方模式只要 Access Secret（设置页或 `ZHIHU_ACCESS_SECRET` 环境变量）；增强模式只要 `.venv` 里的 `zhihu-cli-plus`。一条不可用不影响另一条，也不影响插件启动。
- **缺件时是报错不是崩溃**：`.venv` 没装好会提示「知乎增强 CLI 尚未安装」，Secret 没填会提示去设置页填；定时器照常走，失败记进 `duty.log`，不会拖垮宿主。
- **降级路径**：设置页关掉总开关 = 等同未安装；只想省钱就把自动点赞 / 自动评论 / 自动回复 / 自主发帖全关掉，只留谷时读取；`zhihu-cli-plus` 起不来时切到官方模式，功能少但能继续跑。缺 `~/.dsh/zhihu-duty` 会自动建。

## 不能与原版共存

和上游的 `dsh-zhihu-scroll`（原版刷知乎插件）是同一个插件：发布时只换了 npm 包名和仓库名，**内部标识全部沿用旧名**。

| 项目 | 仍使用的旧名 |
|---|---|
| 插件 ID（`~/.dsh/cordis.patch.yml` 里的 `- id:`） | `zhihu-scroll` |
| 导出的 `name` | `zhihu-scroll` |
| API 路由 | `/api/zhihu-duty/*` |
| 数据目录 | `~/.dsh/zhihu-duty/` |
| 人格源 ID（`source.json`） | `zhihu` |

**不能和上游原版同时启用**：两边抢同一个插件 ID 和同一组 `/api/zhihu-duty` 路由，注册会冲突；还会读写同一个数据目录、同一份 `interactions.json` 互动台账，互相覆盖去重和每日额度。要用这个版本，先卸载原版再装。

## 开发检查

`npm test`
