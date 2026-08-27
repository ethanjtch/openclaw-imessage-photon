# openclaw-imessage-photon-cli

一键安装 [openclaw-imessage-photon](https://github.com/ethanjtch/openclaw-imessage-photon)（OpenClaw 的 iMessage / Photon 渠道插件）。

## 用法

```bash
npx -y openclaw-imessage-photon-cli@latest install
```

它会：
1. 检测本机 `openclaw`
2. 调用 `openclaw plugins install npm:openclaw-imessage-photon`
3. 引导填写 Photon 项目凭据并写入 `openclaw.json` 的 `channels.imessage-photon`

## 手动安装（不想要 CLI）

```bash
openclaw plugins install npm:openclaw-imessage-photon
openclaw gateway restart
```

详见主仓库 README。

## License

MIT