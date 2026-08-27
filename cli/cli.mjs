#!/usr/bin/env node
/**
 * openclaw-imessage-photon-cli
 *
 * Lightweight installer for the OpenClaw iMessage (Photon) channel plugin.
 *
 * Usage:
 *   npx -y openclaw-imessage-photon-cli@latest install
 */
import { execSync, spawnSync } from "node:child_process";

const PLUGIN_SPEC = "npm:openclaw-imessage-photon";
const CHANNEL_ID = "imessage-photon";

function log(msg) {
  console.log(`\x1b[36m[imessage-photon]\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[imessage-photon]\x1b[0m ${msg}`);
}

function run(cmd, { silent = true } = {}) {
  const stdio = silent ? ["pipe", "pipe", "pipe"] : "inherit";
  const result = spawnSync(cmd, { shell: true, stdio });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${cmd}`);
  }
  return silent ? (result.stdout || "").toString().trim() : "";
}

function which(bin) {
  try {
    return execSync(`which ${bin}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function getOpenclawVersion() {
  try {
    return run("openclaw --version").trim();
  } catch {
    return "";
  }
}

/**
 * Open the gateway systemd env file and append DEEPGRAM/etc? No — this CLI only
 * installs the channel. Credentials are set via `openclaw onboard` or by
 * editing channels.imessage-photon in openclaw.json (prompted below).
 */
function prompt(label) {
  return new Promise((resolve) => {
    process.stdout.write(`\x1b[36m[imessage-photon]\x1b[0m ${label}: `);
    process.stdin.once("data", (buf) => resolve(buf.toString().trim()));
  });
}

async function install() {
  // 1. Check openclaw
  if (!which("openclaw")) {
    error("未找到 openclaw。请先安装：");
    console.log("  npm install -g openclaw");
    console.log("  详见 https://docs.openclaw.ai/install");
    process.exit(1);
  }
  const version = getOpenclawVersion();
  log(`检测到 OpenClaw: ${version || "(未知版本)"}`);

  // 2. Install the channel plugin via OpenClaw's package manager
  log(`安装渠道插件 ${PLUGIN_SPEC} ...`);
  try {
    run(`openclaw plugins install "${PLUGIN_SPEC}"`);
    log("渠道插件安装完成。");
  } catch (err) {
    error("安装失败，请尝试手动执行：");
    console.log(`  openclaw plugins install "${PLUGIN_SPEC}"`);
    console.error(String(err.message || err));
    process.exit(1);
  }

  // 3. Prompt for credentials if the channel isn't configured yet
  log("现在需要配置 Photon 项目凭据。");
  log("（也可先跳过，稍后用 `openclaw onboard` 或编辑 openclaw.json 配置）");

  const skip = (await prompt("已注册 https://photon.codes 并创建项目？[y/N]")).toLowerCase();
  if (skip !== "y" && skip !== "yes") {
    log("跳过凭据配置。稍后配置：编辑 openclaw.json 的 channels.imessage-photon 或运行 openclaw onboard。");
    return;
  }

  const projectId = await prompt("Photon Project ID");
  const projectSecret = await prompt("Photon Project Secret（不会显示）");

  // 4. Write channels.imessage-photon into openclaw.json (best-effort, non-destructive)
  const configPath = `${process.env.HOME || "/root"}/.openclaw/openclaw.json`;
  try {
    const fs = await import("node:fs");
    const raw = fs.readFileSync(configPath, "utf8");
    const cfg = JSON.parse(raw);
    cfg.channels = cfg.channels || {};
    cfg.channels[CHANNEL_ID] = {
      ...(cfg.channels[CHANNEL_ID] || {}),
      enabled: true,
      projectId,
      projectSecret,
    };
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    log(`已写入配置：${configPath} 的 channels.${CHANNEL_ID}`);
    log("重启 gateway 生效：openclaw gateway restart");
  } catch (err) {
    error("写入 openclaw.json 失败，请手动编辑：");
    console.log(`  channels.${CHANNEL_ID}: { enabled: true, projectId: "...", projectSecret: "..." }`);
    console.error(String(err.message || err));
  }

  log("完成！已将凭据写入配置。如果目标是 iMessage，请确保 allowFrom 包含你的号码。");
}

const command = process.argv[2] || "install";
switch (command) {
  case "install":
  case "config":
    install().catch((err) => {
      error(String(err.message || err));
      process.exit(1);
    });
    break;
  case "--help":
  case "help":
  default:
    console.log(`用法: npx openclaw-imessage-photon-cli install`);
    break;
}