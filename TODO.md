# TODO / 开发备忘

## 待办（优先级排序）

- [x] **重连机制**：Spectrum 消息流断开后 backoff 自动重连（已实现，日志可见 reconnecting）
- [ ] **消息去重**：48h 窗口去重 + 重启后防止重复处理（~30 行）
- [ ] **测试文件**：config 解析 / inbound 分类 / 去重逻辑（3 个聚焦测试）
- [ ] **media bug 修复**（已完成，待回归）：sendAttachment buffer/MIME 修复、sendVoice→sendAttachment、入站媒体保存、reply 类型入站
- [ ] **inbound 全类型处理**（已完成）：转发 text/reply/attachment/voice/tapback/poll；记录 edit/unsend/read/typing/contact/group
- [ ] **设备码 onboarding**：调 Photon 公开 API（app.photon.codes/api/auth/device/*）自动 provisioning，自实现（~150 行）
- [ ] **测试文件**：config 解析 / inbound 分类 / 去重逻辑（3 个聚焦测试）
- [ ] **message tool + 媒体 + 投票**（用户决策：全打通 + 配置开关默认关闭）：
  - [ ] 实现 `describeMessageTool` + actions（agent 主动发消息，cron 可用）
  - [ ] 媒体 `enableMedia`（attachment 收发）
  - [ ] 投票 `enablePoll`（poll 发起，独立发不带回复）
  - [ ] 特效 `enableEffects`（effect 包装）
  - [ ] 名片/语音等其它开关（可选）
  - [ ] 群组 `enableGroups`（spectrum-ts 原生支持，需加 @ 门控）（可选）
  - [ ] typing 指示 `enableTyping`（spectrum-ts 原生 typing 类型）（可选）
  - [ ] read receipts `enableReadReceipts`（spectrum-ts 原生 message.read()）（可选）
- [ ] **photonDoctor：不做**（用 openclaw channels status + logs）
- [ ] **device-code onboarding**：调 Photon 公开 API（app.photon.codes/api/auth/device/*）自动 provisioning，自实现（~150 行）
- [x] **开源准备（初版完成）**：
  - [x] README（对比 + 感谢 Mouxy + 功能矩阵 + 安装/配置/开发）
  - [x] LICENSE（MIT）+ .gitignore
  - [x] git init + 首次提交（5ec8078）
  - [x] package.json 元数据（author/repository/homepage）
  - [ ] 替换 `<your-github-username>` 占位 → 真实 GitHub 地址
  - [ ] 推送 remote 到 GitHub

## README 必写内容（用户要求）

1. 与 [Mouxy/openclaw-photon](https://github.com/Mouxy/openclaw-photon) 的对比：
   - 架构一致（都是 gateway 进程内的原生 channel 插件，非 bridge）
   - 本项目精简：仅 DM 场景 + 文本/反应/ack/tapback，无 advanced-imessage 依赖
   - 借鉴了 device-code 登录 / 重连思路（自实现，未使用其代码）
2. **感谢 Mouxy 提供的灵感**（其项目 license 为 UNLICENSED，本项目为独立实现）
3. **功能矩阵表**：iMessage 能力 × 我们 × Mouxy 的支持情况（✅/❌/开关），明确标注不支持项：
   - 贴纸 / 高级特效（需 advanced-imessage，不做）
   - mini-app / 状态卡片（business 账号专属，不做）
   - photonDoctor（不做，用 openclaw channels status + logs）
   - 群组 / typing / read receipts（spectrum-ts 原生支持，可选开关）

## 架构备忘

- 插件位置：`/root/openclaw-plugins/imessage-photon/`
- 安装位置：`/root/.openclaw/extensions/imessage-photon/`（开发时改 src → `npm run build` → `cp -r dist/* ~/.openclaw/extensions/imessage-photon/dist/` → `systemctl --user restart openclaw-gateway`）
- 凭据：`channels.imessage-photon.{projectId,projectSecret}` 或 env `SPECTRUM_PROJECT_ID`/`SPECTRUM_PROJECT_SECRET`
- 原生 imsg channel（stock:imessage）保持 disabled，用的是我们自己的 `imessage-photon` channel
