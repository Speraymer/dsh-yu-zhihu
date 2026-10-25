# dsh-yu-zhihu

> 为保护现有登录态和素材，内部 ID、API 路由和数据目录保持兼容。

## 安装

```powershell
dsh plugin --profile desktop add github:Speraymer/dsh-yu-zhihu
```

从本机目录装（改了源码要立刻生效时用，把 `<本机路径>` 换成本仓库所在目录）：

```powershell
dsh plugin --profile desktop add link:<本机路径>/dsh-yu-zhihu
```

装完在 DSH 设置页打开「刷知乎」，再按上面的说明选读取模式：官方模式填 Access Secret，增强模式在插件目录建 `.venv` 装 `zhihu-cli-plus` 后扫码登录。

## 开发检查

`npm test`

### 扫码接口被拒绝时

设置 → 刷知乎 → **浏览器登录（推荐）**。插件打开独立的 Edge 窗口，在知乎官网扫码或短信登录后自动接收登录状态，无需复制 Cookie。不会使用现有浏览器个人资料；只保存知乎所需的三个 Cookie，替换前保留旧凭据备份。独立浏览器资料位于插件数据目录的 `login-browser-*` 中，不会自动永久删除。

直接扫码仍可使用，但知乎可能以 403 风控拒绝扫码状态查询；此时应改用浏览器登录，不能只凭二维码出现就认为授权成功。取消或超时会结束本次独立窗口。浏览器授权已保存但连接检查失败时，可以稍后点击“检查连接”。
