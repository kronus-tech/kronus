/**
 * Google Drive integration for Kronus Daemon
 *
 * Uses a GCP service account to upload files and manage sharing.
 * Files are mirrored from local paths to a "Kronus" folder in Drive.
 * Local path: ~/Desktop/projects/xyz/file.md → Drive path: Kronus/projects/xyz/file.md
 *
 * Setup:
 * 1. Create GCP service account with Drive API enabled
 * 2. Download JSON key to ~/.claude/channels/telegram/google-drive-key.json
 * 3. Create "Kronus" folder in Google Drive
 * 4. Share the folder with the service account email (Editor access)
 */

import { readFileSync, existsSync } from "fs"
import { join, basename, dirname, relative } from "path"
import { homedir } from "os"
import { Logger } from "./config"

const KEY_FILE = join(homedir(), ".claude", "channels", "telegram", "google-drive-key.json")
const DESKTOP_BASE = join(homedir(), "Desktop")
const DRIVE_ROOT_NAME = "Kronus"

interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri: string
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
}

export class GoogleDriveManager {
  private logger: Logger
  private key: ServiceAccountKey | null = null
  private accessToken: string | null = null
  private tokenExpiry = 0
  private rootFolderId: string | null = null
  private folderCache: Map<string, string> = new Map() // path → folderId

  constructor(logger: Logger) {
    this.logger = logger
    this.loadKey()
  }

  get isConfigured(): boolean {
    return this.key !== null
  }

  /** Load service account key from disk */
  private loadKey(): void {
    try {
      if (!existsSync(KEY_FILE)) {
        this.logger.info("Google Drive: no service account key found. Drive features disabled.")
        return
      }
      this.key = JSON.parse(readFileSync(KEY_FILE, "utf8")) as ServiceAccountKey
      this.logger.info(`Google Drive: configured with ${this.key.client_email}`)
    } catch (error) {
      this.logger.error(`Google Drive: failed to load key: ${error}`)
    }
  }

  /** Generate a JWT and exchange it for an access token */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    if (!this.key) throw new Error("No service account key configured")

    // Build JWT
    const header = { alg: "RS256", typ: "JWT" }
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: this.key.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: this.key.token_uri,
      iat: now,
      exp: now + 3600,
    }

    const b64url = (data: object) => {
      const json = JSON.stringify(data)
      return Buffer.from(json).toString("base64url")
    }

    const unsigned = `${b64url(header)}.${b64url(payload)}`

    // Sign with RSA private key
    const crypto = await import("crypto")
    const sign = crypto.createSign("RSA-SHA256")
    sign.update(unsigned)
    const signature = sign.sign(this.key.private_key, "base64url")

    const jwt = `${unsigned}.${signature}`

    // Exchange JWT for access token
    const response = await fetch(this.key.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Token exchange failed: ${response.status} ${error}`)
    }

    const data = await response.json() as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000 // Refresh 60s early
    return this.accessToken
  }

  /** Find the Kronus root folder in Drive */
  private async findRootFolder(): Promise<string> {
    if (this.rootFolderId) return this.rootFolderId

    const token = await this.getAccessToken()
    const query = `name='${DRIVE_ROOT_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    const data = await response.json() as { files: DriveFile[] }
    if (data.files.length === 0) {
      throw new Error(`No "${DRIVE_ROOT_NAME}" folder found in Drive. Create it and share with the service account.`)
    }

    this.rootFolderId = data.files[0].id
    this.logger.info(`Google Drive: root folder "${DRIVE_ROOT_NAME}" = ${this.rootFolderId}`)
    return this.rootFolderId
  }

  /** Create a folder in Drive (or return existing) */
  private async ensureFolder(name: string, parentId: string): Promise<string> {
    const cacheKey = `${parentId}/${name}`
    if (this.folderCache.has(cacheKey)) return this.folderCache.get(cacheKey)!

    const token = await this.getAccessToken()

    // Check if folder exists
    const query = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const searchData = await searchResponse.json() as { files: DriveFile[] }

    if (searchData.files.length > 0) {
      this.folderCache.set(cacheKey, searchData.files[0].id)
      return searchData.files[0].id
    }

    // Create folder
    const createResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    })

    const created = await createResponse.json() as DriveFile
    this.folderCache.set(cacheKey, created.id)
    this.logger.info(`Google Drive: created folder "${name}" in ${parentId}`)
    return created.id
  }

  /** Ensure the full folder path exists and return the leaf folder ID */
  private async ensureFolderPath(relativePath: string): Promise<string> {
    let currentId = await this.findRootFolder()
    const parts = relativePath.split("/").filter(Boolean)

    for (const part of parts) {
      currentId = await this.ensureFolder(part, currentId)
    }

    return currentId
  }

  /** Convert a local file path to a Drive relative path */
  private localToDrivePath(localPath: string): string {
    // ~/Desktop/projects/xyz/file.md → projects/xyz/
    const rel = relative(DESKTOP_BASE, dirname(localPath))
    return rel
  }

  /** Upload a file to Google Drive */
  async uploadFile(localPath: string): Promise<{ fileId: string; webLink: string } | null> {
    if (!this.key) return null

    try {
      if (!existsSync(localPath)) {
        this.logger.error(`Google Drive: file not found: ${localPath}`)
        return null
      }

      const token = await this.getAccessToken()
      const fileName = basename(localPath)
      const drivePath = this.localToDrivePath(localPath)
      const folderId = await this.ensureFolderPath(drivePath)

      // Check if file already exists (update instead of duplicate)
      const query = `name='${fileName}' and '${folderId}' in parents and trashed=false`
      const searchResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const searchData = await searchResponse.json() as { files: DriveFile[] }

      const fileContent = readFileSync(localPath)
      const mimeType = this.getMimeType(fileName)

      let fileId: string
      let webLink: string

      if (searchData.files.length > 0) {
        // Update existing file
        fileId = searchData.files[0].id
        const updateResponse = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,webViewLink`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": mimeType,
            },
            body: fileContent,
          }
        )
        const updated = await updateResponse.json() as DriveFile
        webLink = updated.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`
        this.logger.info(`Google Drive: updated "${fileName}" in ${drivePath}`)
      } else {
        // Create new file with multipart upload
        const boundary = "kronus_upload_boundary"
        const metadata = JSON.stringify({
          name: fileName,
          parents: [folderId],
        })

        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`),
          Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
          fileContent,
          Buffer.from(`\r\n--${boundary}--`),
        ])

        const createResponse = await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body,
          }
        )

        const created = await createResponse.json() as DriveFile
        fileId = created.id
        webLink = created.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`
        this.logger.info(`Google Drive: uploaded "${fileName}" to ${drivePath}`)
      }

      return { fileId, webLink }
    } catch (error) {
      this.logger.error(`Google Drive upload failed: ${error}`)
      return null
    }
  }

  /** Share a file with a specific email (edit access) */
  async shareFile(fileId: string, email: string): Promise<boolean> {
    if (!this.key) return false

    try {
      const token = await this.getAccessToken()

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "user",
            role: "writer",
            emailAddress: email,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.text()
        this.logger.error(`Google Drive share failed: ${error}`)
        return false
      }

      this.logger.info(`Google Drive: shared ${fileId} with ${email} (editor)`)
      return true
    } catch (error) {
      this.logger.error(`Google Drive share failed: ${error}`)
      return false
    }
  }

  /** Upload a file and share with an email in one call */
  async uploadAndShare(localPath: string, email: string): Promise<{ webLink: string } | null> {
    const result = await this.uploadFile(localPath)
    if (!result) return null

    await this.shareFile(result.fileId, email)
    return { webLink: result.webLink }
  }

  /** Get MIME type from filename */
  private getMimeType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      md: "text/markdown",
      txt: "text/plain",
      json: "application/json",
      ts: "text/typescript",
      js: "application/javascript",
      py: "text/x-python",
      html: "text/html",
      css: "text/css",
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      csv: "text/csv",
      yaml: "text/yaml",
      yml: "text/yaml",
    }
    return mimeTypes[ext ?? ""] ?? "application/octet-stream"
  }
}
