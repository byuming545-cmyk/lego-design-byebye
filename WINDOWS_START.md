# 在 Windows 电脑上打开汽车程序

本说明对应 GitHub 分支 `codex/vehicle-assembly-sequence`。

## 下载完整项目

打开这个分支页面，点击绿色 **Code → Download ZIP**，下载后右键 **全部解压**：

https://github.com/byuming545-cmyk/lego-design-byebye/tree/codex/vehicle-assembly-sequence

进入解压后的项目文件夹，确认里面可以看到 `package.json`、`src` 和 `public`。

## 在自己电脑启动完整版

需要 Node.js **24.5 或以上版本**，建议使用 Node.js 24 LTS。可在终端运行 `node -v` 查看；尚未安装时从 https://nodejs.org/ 安装后重新打开终端。

1. 在这个项目文件夹的资源管理器地址栏输入 `powershell`，按回车。
2. 首次运行依次输入下面两条命令，每条执行完再执行下一条：

```powershell
npm.cmd ci
npm.cmd run preview
```

首次安装依赖需要联网。构建完成并显示服务启动后，在同一台电脑的浏览器打开：

http://localhost:3000/vehicle-generator

终端窗口在使用期间保持打开。退出程序时，在终端按 Ctrl+C。

以后再次打开，在项目文件夹启动终端，只需执行：

```powershell
npm.cmd run preview
```

`npm.cmd` 可直接在 Windows PowerShell 中运行，不需要调整脚本执行策略。

## 操作

选择 Charger 或 Golf，可使用已准备资料重新生成，也可点击“打开已保存示例”。已有两车资料随项目提供，演示它们不需要输入 API Key。

模型下方可选择八色、四组配色预设；切换“拼搭顺序演示（草稿）”，点击“开始演示”或“播放”，可选择 4×速度和跳转阶段。

建议顺序演示，连接、安装路径与实物拼搭尚未完整验证；当前不是已验证实拼说明书。

## 直接打开离线演示

只查看两款已保存模型时，也可在解压后的项目中找到：

```text
artifacts/vehicle-sequence-2026-11-07/offline/bricklab-sequence-demo.html
```

用电脑 Chrome 或 Edge 打开。这个文件已内嵌全部运行内容，不执行新车型生成。根目录的 `OPEN_CAR_DEMO.html` 是同一演示的压缩单文件版本。

仓库里的 ZIP 文件也可从 GitHub 文件页面下载。点击文件页面上的 **Download raw file** 图标（向下箭头），或使用提供的 GitHub 原始文件下载链接。

如果出现错误，请保留终端里的完整报错，并提供 `node -v` 的结果；不要重复输入密钥，也不需要购买服务。
