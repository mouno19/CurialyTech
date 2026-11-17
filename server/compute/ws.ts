import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// Minimal RFC 6455 WebSocket transport (server upgrade + client dialer) with zero external packages.
// Supports text/binary frames, continuation reassembly, ping/pong keepalives, and clean close codes.

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_WS_PAYLOAD = 32 * 1024 * 1024; // 32 MiB cap per message

export interface WsSocket extends EventEmitter {
  readonly open: boolean;
  send(text: string): boolean;
  ping(payload?: Buffer): boolean;
  close(code?: number, reason?: string): void;
  destroy(): void;
  on(event: "message", listener: (data: string) => void): this;
  on(event: "pong", listener: () => void): this;
  on(event: "close", listener: (code: number, reason: string) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export function encodeFrame(opcode: number, payload: Buffer, masked: boolean): Buffer {
  const len = payload.length;
  const headerLen = 2 + (len < 126 ? 0 : len < 65536 ? 2 : 8) + (masked ? 4 : 0);
  const frame = Buffer.allocUnsafe(headerLen + len);
  frame[0] = 0x80 | (opcode & 0x0f);
  const maskBit = masked ? 0x80 : 0;
  let offset = 2;
  if (len < 126) {
    frame[1] = maskBit | len;
  } else if (len < 65536) {
    frame[1] = maskBit | 126;
    frame.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    frame[1] = maskBit | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  }
  if (masked) {
    const mask = randomBytes(4);
    mask.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < len; i++) frame[offset + i] = payload[i] ^ mask[i & 3];
  } else {
    payload.copy(frame, offset);
  }
  return frame;
}

export function attachWebSocket(stream: Duplex, opts: { maskOutgoing: boolean; maxPayload?: number }): WsSocket {
  const emitter = new EventEmitter() as WsSocket;
  const maxPayload = opts.maxPayload ?? MAX_WS_PAYLOAD;
  let isOpen = true;
  let closeSent = false;
  let buffer: Buffer = Buffer.alloc(0);
  let fragOpcode: number | null = null;
  let fragChunks: Buffer[] = [];
  let fragBytes = 0;

  const writeRaw = (opcode: number, payload: Buffer) => {
    if (!isOpen && opcode !== 0x08) return false;
    try {
      return stream.write(encodeFrame(opcode, payload, opts.maskOutgoing));
    } catch {
      return false;
    }
  };

  const finishClose = (code: number, reason: string) => {
    if (!isOpen) return;
    isOpen = false;
    fragChunks = [];
    buffer = Buffer.alloc(0);
    try { stream.end(); } catch { /* ignore */ }
    setTimeout(() => { try { stream.destroy(); } catch { /* ignore */ } }, 1000).unref();
    emitter.emit("close", code, reason);
  };

  const protocolError = (reason: string) => {
    if (!closeSent) {
      closeSent = true;
      const body = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
      body.writeUInt16BE(1002, 0);
      body.write(reason, 2);
      writeRaw(0x08, body.subarray(0, 125));
    }
    finishClose(1002, reason);
  };

  stream.on("data", (chunk: Buffer) => {
    if (!isOpen) return;
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    while (isOpen && buffer.length >= 2) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      if (rsv !== 0) return protocolError("Unsupported RSV bits");

      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(maxPayload)) return protocolError("Frame exceeds payload limit");
        len = Number(big);
        offset = 10;
      }
      if (len > maxPayload) return protocolError("Frame exceeds payload limit");

      const totalFrame = offset + (masked ? 4 : 0) + len;
      if (buffer.length < totalFrame) return;

      let payload: Buffer;
      if (masked) {
        const maskOffset = offset;
        const dataOffset = offset + 4;
        payload = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) payload[i] = buffer[dataOffset + i] ^ buffer[maskOffset + (i & 3)];
      } else {
        payload = Buffer.from(buffer.subarray(offset, offset + len));
      }
      buffer = buffer.subarray(totalFrame);

      // Control frames (0x08..0x0f) must not be fragmented and may arrive between data fragments.
      if (opcode >= 0x08) {
        if (!fin || len > 125) return protocolError("Invalid control frame");
        if (opcode === 0x08) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
          const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
          if (!closeSent) {
            closeSent = true;
            const echo = Buffer.allocUnsafe(2);
            echo.writeUInt16BE(code === 1005 ? 1000 : code, 0);
            writeRaw(0x08, echo);
          }
          finishClose(code, reason);
          return;
        }
        if (opcode === 0x09) {
          writeRaw(0x0a, payload);
          continue;
        }
        if (opcode === 0x0a) {
          emitter.emit("pong");
          continue;
        }
        return protocolError("Unknown control opcode");
      }

      if (opcode === 0x00) {
        if (fragOpcode === null) return protocolError("Unexpected continuation frame");
        fragBytes += payload.length;
        if (fragBytes > maxPayload) return protocolError("Message exceeds payload limit");
        fragChunks.push(payload);
        if (fin) {
          const full = Buffer.concat(fragChunks, fragBytes);
          fragOpcode = null;
          fragChunks = [];
          fragBytes = 0;
          emitter.emit("message", full.toString("utf8"));
        }
      } else if (opcode === 0x01 || opcode === 0x02) {
        if (fragOpcode !== null) return protocolError("Unfinished fragmented message");
        if (fin) {
          emitter.emit("message", payload.toString("utf8"));
        } else {
          fragOpcode = opcode;
          fragChunks = [payload];
          fragBytes = payload.length;
        }
      } else {
        return protocolError("Unsupported data opcode");
      }
    }
  });

  stream.on("end", () => finishClose(1006, "Stream ended"));
  stream.on("close", () => finishClose(1006, "Connection closed"));
  stream.on("error", error => {
    if (emitter.listenerCount("error") > 0) emitter.emit("error", error);
    finishClose(1006, error.message);
  });

  Object.defineProperty(emitter, "open", { get: () => isOpen });
  emitter.send = (text: string) => writeRaw(0x01, Buffer.from(text, "utf8"));
  emitter.ping = (payload = Buffer.alloc(0)) => writeRaw(0x09, payload.subarray(0, 125));
  emitter.close = (code = 1000, reason = "") => {
    if (!isOpen) return;
    if (!closeSent) {
      closeSent = true;
      const reasonBuf = Buffer.from(reason, "utf8").subarray(0, 120);
      const body = Buffer.allocUnsafe(2 + reasonBuf.length);
      body.writeUInt16BE(code, 0);
      reasonBuf.copy(body, 2);
      writeRaw(0x08, body);
    }
    finishClose(code, reason);
  };
  emitter.destroy = () => {
    isOpen = false;
    try { stream.destroy(); } catch { /* ignore */ }
  };

  return emitter;
}

export function upgradeToWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): WsSocket | null {
  const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
  const key = typeof req.headers["sec-websocket-key"] === "string" ? req.headers["sec-websocket-key"].trim() : "";
  if (upgrade !== "websocket" || !key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return null;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );
  if ("setNoDelay" in socket && typeof (socket as { setNoDelay?: (v: boolean) => void }).setNoDelay === "function") {
    (socket as { setNoDelay: (v: boolean) => void }).setNoDelay(true);
  }
  const ws = attachWebSocket(socket, { maskOutgoing: false });
  if (head && head.length > 0) socket.unshift(head);
  return ws;
}

export function rejectUpgrade(socket: Duplex, status: number, message: string) {
  const body = JSON.stringify({ error: message });
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Bad Request"}\r\n` +
      `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
  socket.destroy();
}
