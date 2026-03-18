# 在 Windows 上得到可用的 exe

在 **Linux 上** 用 `npm run build:win` 打出来的是“跨平台构建”的 exe，在 Windows 上运行时有可能报错（证书、路径或运行库等差异）。

**推荐做法：在 Windows 环境里构建一次。**

## 方式一：本机有 Windows

在 Windows 上打开项目，执行：

```bash
npm install
npm run build:win
```

产物在 `release/` 下（如 `邮箱监控 1.0.0.exe`），这个 exe 在 Windows 上运行最稳定。

## 方式二：用 GitHub Actions（在 Linux 上也能拿到 Windows exe）

项目已配置好 **GitHub Actions**，在 **Windows 虚拟机**里自动构建：

1. 把项目推到 GitHub（例如仓库名 `ideal-list`）。
2. 打开仓库 → **Actions** → 选 **Build Windows exe**，可手动 **Run workflow** 或等 push 到 `main`/`master` 自动跑。
3. 跑完后在该次运行的 **Artifacts** 里下载 **windows-exe**，解压即得到 `release/` 下的 exe 和目录。

这样你在 Linux 上开发，无需装 Windows，也能拿到在 Windows 上可用的 exe。
