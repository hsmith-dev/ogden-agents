// @vitest-environment happy-dom
/**
 * The terminal socket's frames (story 3.6): `attach` with the viewer's size
 * is the first frame once open (never a `resize`), `size` frames from the
 * server reach `onSize`, and a malformed or foreign text frame is ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectTerminal, type TerminalSocketHandlers } from '../src/terminal/terminal-socket';

/** A stand-in WebSocket that records what is sent and lets the test fire events. */
class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeSocket | undefined;
  readyState = FakeSocket.CONNECTING;
  binaryType = 'blob';
  sent: unknown[] = [];
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    super();
    FakeSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const auth = { webSocketProtocols: (): [string, string] => ['ogden-agents', 'token.abc'] };

function handlers(): TerminalSocketHandlers & { [K in keyof TerminalSocketHandlers]: ReturnType<typeof vi.fn> } {
  return {
    size: vi.fn(() => ({ cols: 120, rows: 40 })),
    onOpen: vi.fn(),
    onBytes: vi.fn(),
    onSize: vi.fn(),
    onExit: vi.fn(),
    onClose: vi.fn(),
  } as never;
}

describe('connectTerminal', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeSocket.last = undefined;
  });

  it('sends attach with the size as the first frame on open, then calls onOpen', () => {
    const on = handlers();
    connectTerminal('ses_1', on, auth);
    const socket = FakeSocket.last!;
    expect(socket.protocols).toEqual(['ogden-agents', 'token.abc']);
    expect(socket.url).not.toContain('token');
    socket.open();
    expect(socket.sent).toEqual([{ type: 'attach', cols: 120, rows: 40 }]);
    expect(on.onOpen).toHaveBeenCalledOnce();
  });

  it('sends later size changes as resize', () => {
    const connection = connectTerminal('ses_1', handlers(), auth)!;
    const socket = FakeSocket.last!;
    connection.resize(80, 24);
    expect(socket.sent).toEqual([]);
    socket.open();
    connection.resize(80, 24);
    expect(socket.sent.at(-1)).toEqual({ type: 'resize', cols: 80, rows: 24 });
  });

  it('follows size frames, reports exit, passes bytes through, and ignores bad or foreign frames', () => {
    const on = handlers();
    connectTerminal('ses_1', on, auth);
    const socket = FakeSocket.last!;
    socket.open();
    socket.receive(JSON.stringify({ type: 'size', cols: 100, rows: 30 }));
    expect(on.onSize).toHaveBeenCalledWith(100, 30);

    socket.receive('not json');
    socket.receive(JSON.stringify({ type: 'size', cols: 0, rows: 30 }));
    socket.receive(JSON.stringify({ type: 'size', cols: 100 }));
    socket.receive(JSON.stringify({ type: 'server.stopping' }));
    expect(on.onSize).toHaveBeenCalledOnce();
    expect(on.onExit).not.toHaveBeenCalled();

    const bytes = new Uint8Array([104, 105]);
    socket.receive(bytes.buffer);
    expect(on.onBytes).toHaveBeenCalledWith(bytes);

    socket.receive(JSON.stringify({ type: 'exit', exitCode: null }));
    expect(on.onExit).toHaveBeenCalledWith(null);
  });

  it('is undefined without a tab token', () => {
    expect(connectTerminal('ses_1', handlers(), { webSocketProtocols: () => undefined })).toBeUndefined();
    expect(FakeSocket.last).toBeUndefined();
  });
});
