#!/usr/bin/env bun
/**
 * Kronus Daemon — Telegram Control Plane for Claude Code
 *
 * Routes Telegram group messages to per-project Claude Code sessions.
 * Uses headless mode (claude -p --output-format stream-json) for structured
 * output and --resume for session continuity.
 *
 * Start: bun run src/index.ts
 * Stop:  kill $(cat ~/.claude/channels/telegram/daemon.pid)
 */

import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { loadDaemonConfig, Logger } from "./config"
import { TelegramRouter } from "./telegram-router"
import { startApiServer } from "./api"

const PID_FILE = join(homedir(), ".claude", "channels", "telegram", "daemon.pid")

function writePidFile(): void {
  writeFileSync(PID_FILE, String(process.pid))
}

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE)
  } catch {
    // File may not exist
  }
}

function checkExistingDaemon(): void {
  if (!existsSync(PID_FILE)) return

  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim())
    // Check if process is still running
    process.kill(pid, 0)
    console.error(`Daemon already running (PID ${pid}). Stop it first or remove ${PID_FILE}`)
    process.exit(1)
  } catch {
    // Process not running, clean up stale PID file
    removePidFile()
  }
}

function checkPluginConflict(): void {
  const settingsFile = join(homedir(), ".claude", "settings.json")
  try {
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"))
    const plugins = settings.enabledPlugins ?? {}
    if (plugins["telegram@claude-plugins-official"]) {
      console.error(
        "WARNING: The Telegram plugin is enabled in ~/.claude/settings.json.\n" +
        "The daemon and plugin both poll getUpdates on the same bot token — they cannot run simultaneously.\n" +
        "Disable the plugin by setting telegram@claude-plugins-official to false in ~/.claude/settings.json,\n" +
        "or use a different bot token for the daemon.\n"
      )
    }
  } catch {
    // Settings file may not exist or be invalid
  }
}

async function main(): Promise<void> {
  console.log("Kronus v5.5")
  console.log("=============\n")

  // Pre-flight checks
  checkExistingDaemon()
  checkPluginConflict()

  // Load configuration
  const config = loadDaemonConfig()
  const logger = new Logger(config.logFile)

  logger.info("Starting Kronus v5.5")
  logger.info(`State dir: ${config.stateDir}`)
  logger.info(`Log file: ${config.logFile}`)
  logger.info(`Session timeout: ${config.sessionTimeoutMs / 1000}s`)

  // Create router
  const router = new TelegramRouter(
    config.botToken,
    logger,
    config.sessionTimeoutMs
  )

  // Write PID file
  writePidFile()
  logger.info(`PID file: ${PID_FILE} (${process.pid})`)

  // Handle shutdown signals
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`)
    await router.stop()
    removePidFile()
    logger.info("Daemon stopped")
    process.exit(0)
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGHUP", () => shutdown("SIGHUP"))

  // Unhandled errors — log but don't crash. Ignore EPIPE (broken stdout pipe when backgrounded).
  process.on("unhandledRejection", (err) => {
    const msg = String(err)
    if (msg.includes("EPIPE")) return
    logger.error(`Unhandled rejection: ${msg}`)
  })
  process.on("uncaughtException", (err) => {
    if ("code" in err && err.code === "EPIPE") return
    logger.error(`Uncaught exception: ${err}`)
  })

  // Start dashboard API + Telegram bot
  try {
    startApiServer(router.getSessionManager(), logger)
    logger.info("Dashboard API started on :8420")

    await router.start()
    console.log("Kronus started. Dashboard: http://localhost:8420\n")
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to start: ${msg}`)
    console.error(`Failed to start daemon: ${msg}`)
    removePidFile()
    process.exit(1)
  }
}

main()
