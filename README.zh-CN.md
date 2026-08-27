# openclaw-imessage-photon

基于 **Photon Spectrum Cloud** 的 [OpenClaw](https://github.com/contaxy/openclaw) iMessage 渠道插件 —— **无需 Mac、无需 iMessage 服务器、无独立 bridge 进程**。

在你的 VPS/云服务器上直接跑 iMessage：你的 agent 通过 Photon 云中继与 iMessage 联系人对话，以 OpenClaw 原生渠道插件形式运行（在 gateway 进程内 —— 没有每次消息临时起 CLI 进程、没有瞬时 agent 进程）。

## 亮点

- **原生渠道插件** —— 运行于 OpenClaw gateway 进程内；消息直接进入内嵌 agent 运行时。
- **无需 Mac** —— Photon Spectrum Cloud 中继 iMessage。
- **文本、图片、语音、投票、特效、名片** —— 双向。
- **语音转写** —— 通过普通 OpenClaw 配置接入任意 `tools.media.audio` 转录 provider（Deepgram、ElevenLabs、Groq……）。
- **对用户友好的默认行为** —— DM 白名单、👀 已读反应、tapback、自动重连、已读回执、输入中指示。
- **引导式配置向导** —— `openclaw onboard` 引导完成 Photon 项目配置（凭据通过 `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` 环境变量，或从控制台粘贴）。

## 安装

要求：OpenClaw ≥ 2026.7.1，Node 22+。

**通过 npm 安装（推荐）** —— 让任意 AI agent 帮你执行，或手动：

```bash
npx -y openclaw-imessage-photon-cli@latest install
```

或直接安装插件包：

```bash
openclaw plugins install npm:openclaw-imessage-photon
```

**从源码安装：**

```bash
git clone https://github.com/ethanjtch/openclaw-imessage-photon
cd openclaw-imessage-photon
npm install
npm run build
openclaw plugins install ./imessage-photon
openclaw gateway restart
```

然后配置渠道（运行 `openclaw onboard` 选择 **iMessage (Photon)**），或直接编辑 `openclaw.json`：

```json5
{
  channels: {
    "imessage-photon": {
      enabled: true,
      projectId: "...",       // 或环境变量 SPECTRUM_PROJECT_ID
      projectSecret: "...",   // 或环境变量 SPECTRUM_PROJECT_SECRET
      allowFrom: ["+8613800138000"], // DM 白名单（E.164）。[] = 所有人
    },
  },
}
```

在 [photon.codes](https://photon.codes) 注册、创建 iMessage provider 项目，复制 Project ID / Secret 填入。

## 配置项

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `projectId` / `projectSecret` | 环境变量 `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` | Photon 项目凭据 |
| `allowFrom` | `[]`（所有人） | DM 白名单，E.164 号码 |
| `ackReaction` | `👀` | 收到文本消息时的"已读/处理中"反应；回复后移除。`""` 关闭 |
| `tapbackNotifications` | `all` | `all` 把 tapback 转发给 agent；`off` 忽略 |
| `enableMedia` | `false` | agent 收发媒体附件 |
| `enablePoll` | `false` | agent 发起投票 |
| `enableEffects` | `false` | 全屏特效（彩带、激光……） |
| `enableContact` | `false` | agent 分享名片 |
| `enableVoice` | `false` | agent 发送语音（走媒体 + audio 内容类型） |
| `enableGroups` | `false` | 处理群聊 |
| `enableTyping` | `false` | 处理中显示输入中指示 |
| `enableReadReceipts` | `false` | 入站消息标记已读 |

### 语音转写

配置任一 OpenClaw 媒体音频转录 provider，例如 Deepgram：

```json5
{
  tools: { media: { audio: { models: [{ provider: "deepgram", model: "nova-3", language: "zh" }] } } },
}
```

需在 gateway 环境中配置对应 provider 的 key（如 `DEEPGRAM_API_KEY`）。入站语音会被保存到媒体库，由核心媒体管线转写，agent 随后能看到转录文本。

## 能力对比矩阵

| iMessage 能力 | 本插件 | [Mouxy/openclaw-photon](https://github.com/Mouxy/openclaw-photon) |
|---|---|---|
| 文本 / 引用回复 / 主动发送 | ✅ | ✅ |
| 媒体（图片/文件，双向） | ✅（`enableMedia`） | ✅ |
| 语音发送 + 入站转写 | ✅（`enableVoice` + `tools.media.audio`） | ✅ |
| 投票（发起） | ✅（`enablePoll`） | ✅ |
| 投票事件通知 | ⚠️ 被上游 spectrum-ts bug 阻断 | ✅ |
| 全屏特效 | ✅（`enableEffects`） | ✅ |
| 名片 | ✅（`enableContact`） | ✅ |
| 群聊 | ✅（`enableGroups`，无 @ 门控） | ✅ |
| Tapback（收到点赞） | ✅ | ✅ |
| 👀 已读反应 | ✅（👀） | — |
| 输入中指示 | ✅（`enableTyping`） | ✅ |
| 已读回执 | ✅（`enableReadReceipts`） | ✅ |
| 贴纸 / 文字动画 | ❌ | ✅（需 `@photon-ai/advanced-imessage`） |
| mini-app / 状态卡片 | ❌（仅 business 账号） | ✅ |
| photonDoctor 诊断工具 | ❌（用 `openclaw channels status`） | ✅ |
| 引导配置 | 手动凭据 / 环境变量 | 设备码自动开通 |
| 许可证 | **MIT** | UNLICENSED |

### 致谢（Attribution）

本项目是**独立实现**，受 [Mouxy/openclaw-photon](https://github.com/Mouxy/openclaw-photon) 的设计及其"OpenClaw 共享 message 工具 + channel runtime 是正确的集成入口"这一洞察启发。**未使用该仓库的任何代码** —— 其许可证为 UNLICENSED；本项目基于 OpenClaw 插件 SDK 与 `spectrum-ts` 从零编写。感谢 Mouxy 提供的灵感。

## 开发

```bash
npm run build              # tsc -> dist/
npm test                   # （计划中）config/inbound/dedupe 单元测试
openclaw plugins install ./imessage-photon --force
systemctl --user restart openclaw-gateway
```

本地安装位于 `~/.openclaw/extensions/imessage-photon/`；重新构建后 `cp -r dist/*` 到该目录，或重新执行 `plugins install --force`。

## 已知问题

- **投票事件通知**：spectrum-ts 的 `toCachedPoll` 会拒绝 poll 标题为空字符串的事件，在库内崩溃并丢弃事件，插件无法看到（issue 草稿：`spectrum-ts-poll-bug-issue-draft.md`）。投票**发起**正常。

## 路线图（Roadmap / TODO）

- [ ] **消息去重**：48 小时窗口去重 + 重启后防止重复处理（防重启重复回复）
- [ ] **测试文件**：config 解析 / inbound 分类 / 去重逻辑（防回归）
- [ ] **设备码 onboarding**：调用 Photon 公开 API（app.photon.codes）自动登录 + 自动开通项目，免手动复制凭据
- [ ] **群组 @ 门控**：`requireMention` 配置（群聊中只有被 @ 才回复）
- [ ] **edit/unsend 通知 agent**：`enableEditUnsend` 开关（收到用户的编辑/撤回事件并回应）
- [ ] multi-account / 远程 iMessage 线路支持细化

## 许可证

[MIT](LICENSE)