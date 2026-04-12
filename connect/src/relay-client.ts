import WebSocket from "ws";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// ── Relay protocol types (mirrors hub/src/relay/types.ts) ─────────────────────

interface RelayMessage {
  target: string;
  payload: unknown;
  request_id?: string;
}

interface RelayResponse {
  source: string;
  payload: unknown;
  request_id?: string;
}

interface RelayError {
  error: { code: string; message: string };
  request_id?: string;
}

// ── Typed event map ───────────────────────────────────────────────────────────

type RelayEventMap = {
  connected: [];
  disconnected: [code: number, reason: string];
  message: [response: RelayResponse];
  error: [error: Error];
  reconnecting: [attempt: number];
};

type EventCallback<K extends keyof RelayEventMap> = (
  ...args: RelayEventMap[K]
) => void;

// ── Internal request tracking ─────────────────────────────────────────────────

interface PendingRequest {
  resolve: (response: RelayResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── RelayClient ───────────────────────────────────────────────────────────────

export class RelayClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private hubUrl = "";
  private token = "";
  private reconnectAttempt = 0;
  private readonly maxReconnectDelay = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<EventCallback<keyof RelayEventMap>>>();
  private onTokenRefresh: (() => Promise<string>) | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Register a callback that returns a fresh access token when the relay
   * connection is closed with close code 4001 (Unauthorized).
   */
  setTokenRefreshHandler(handler: () => Promise<string>): void {
    this.onTokenRefresh = handler;
  }

  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Open the WebSocket connection to the Hub relay.
   * Resets reconnect state so the first failure starts from attempt 1.
   */
  connect(hubUrl: string, token: string): void {
    this.hubUrl = hubUrl;
    this.token = token;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.doConnect();
  }

  /**
   * Permanently close the connection.
   * Rejects all pending requests and cancels any scheduled reconnect.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.rejectAllPending(new Error("Client disconnected"));

    if (this.ws) {
      this.ws.close(1000, "Client disconnected");
      this.ws = null;
    }

    this.setState("disconnected");
  }

  /**
   * Fire-and-forget send. Throws synchronously if not connected.
   */
  send(target: string, payload: unknown, requestId?: string): void {
    if (!this.ws || this.state !== "connected") {
      throw new Error("Not connected to relay");
    }
    const msg: RelayMessage = { target, payload, request_id: requestId };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send a message and wait for the correlated response.
   * Rejects after `timeoutMs` (default 30 s) if no response arrives.
   */
  sendRequest(
    target: string,
    payload: unknown,
    timeoutMs = 30_000
  ): Promise<RelayResponse> {
    const requestId = crypto.randomUUID();

    return new Promise<RelayResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        this.send(target, payload, requestId);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ── Event emitter ───────────────────────────────────────────────────────────

  on<K extends keyof RelayEventMap>(
    event: K,
    callback: EventCallback<K>
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners
      .get(event)!
      .add(callback as EventCallback<keyof RelayEventMap>);
  }

  off<K extends keyof RelayEventMap>(
    event: K,
    callback: EventCallback<K>
  ): void {
    this.listeners
      .get(event)
      ?.delete(callback as EventCallback<keyof RelayEventMap>);
  }

  // ── Internal: connection lifecycle ─────────────────────────────────────────

  private doConnect(): void {
    this.setState("connecting");

    const wsUrl =
      this.hubUrl.replace(/^http/, "ws") +
      "/relay/connect?token=" +
      encodeURIComponent(this.token);

    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      this.setState("connected");
      this.reconnectAttempt = 0;
      this.emit("connected");
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      const text = typeof data === "string" ? data : data.toString();
      this.handleMessage(text);
    });

    this.ws.on("close", async (code: number, reason: Buffer) => {
      const reasonStr = reason.toString();
      this.setState("disconnected");
      this.emit("disconnected", code, reasonStr);

      if (!this.shouldReconnect) return;

      // 4001 = Unauthorized — try a single token refresh before reconnecting
      if (code === 4001 && this.onTokenRefresh && this.reconnectAttempt === 0) {
        try {
          this.token = await this.onTokenRefresh();
          this.scheduleReconnect();
        } catch {
          this.emit(
            "error",
            new Error("Token refresh failed during reconnection")
          );
        }
        return;
      }

      // After a token-refresh attempt, a repeated 4001 means the credentials
      // are genuinely invalid — stop reconnecting.
      if (code === 4001) return;

      this.scheduleReconnect();
    });

    this.ws.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  private handleMessage(text: string): void {
    let parsed: RelayResponse | RelayError;

    try {
      parsed = JSON.parse(text) as RelayResponse | RelayError;
    } catch {
      this.emit("error", new Error("Failed to parse relay message"));
      return;
    }

    if ("error" in parsed) {
      const errMsg = parsed as RelayError;
      const requestId = errMsg.request_id;

      if (requestId !== undefined && this.pendingRequests.has(requestId)) {
        const pending = this.pendingRequests.get(requestId)!;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);
        pending.reject(
          new Error(
            `Relay error: ${errMsg.error.code} — ${errMsg.error.message}`
          )
        );
      }

      this.emit(
        "error",
        new Error(`${errMsg.error.code}: ${errMsg.error.message}`)
      );
      return;
    }

    const response = parsed as RelayResponse;

    if (
      response.request_id !== undefined &&
      this.pendingRequests.has(response.request_id)
    ) {
      const pending = this.pendingRequests.get(response.request_id)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(response.request_id);
      pending.resolve(response);
    } else {
      // Unsolicited push message
      this.emit("message", response);
    }
  }

  /**
   * Exponential backoff: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s (capped).
   */
  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempt - 1),
      this.maxReconnectDelay
    );

    this.setState("reconnecting");
    this.emit("reconnecting", this.reconnectAttempt);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  // ── Internal: helpers ───────────────────────────────────────────────────────

  private setState(newState: ConnectionState): void {
    this.state = newState;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  private emit<K extends keyof RelayEventMap>(
    event: K,
    ...args: RelayEventMap[K]
  ): void {
    const callbacks = this.listeners.get(event);
    if (callbacks === undefined) return;
    for (const cb of callbacks) {
      (cb as EventCallback<K>)(...args);
    }
  }
}
