import { IpcMessage, GwmEvent, GwmEventData } from './types';
import { ServerMessage } from './types/server-message';
import WebSocket from './websocket';

export interface GwmClientOptions {
  port: number;
}

export type MessageCallback = (message: ServerMessage<unknown>) => void;
export type ConnectCallback = (e: Event) => void;
export type DisconnectCallback = (e: CloseEvent) => void;
export type ErrorCallback = (e: Event) => void;
export type SubscribeCallback = (data: GwmEventData) => void;
export type UnlistenFn = () => void;

export class GwmClient {
  /** Default port used by GlazeWM for IPC server. */
  private readonly DEFAULT_PORT = 6123;

  /** Socket connection to IPC server. */
  private _socket = new WebSocket(
    `ws://localhost:${this.options?.port ?? this.DEFAULT_PORT}`,
  );

  private _onMessageCallbacks: MessageCallback[] = [];
  private _onConnectCallbacks: ConnectCallback[] = [];
  private _onDisconnectCallbacks: DisconnectCallback[] = [];
  private _onErrorCallbacks: ErrorCallback[] = [];

  constructor(private options?: GwmClientOptions) {
    this._registerSocketLifecycle();
  }

  /** Send an IPC message without waiting for a reply. */
  send(message: IpcMessage): void {
    this._socket.send(message);
  }

  /** Send an IPC message and wait for a reply. */
  async sendAndWaitReply<T>(message: IpcMessage): Promise<ServerMessage<T>> {
    let unlisten: UnlistenFn;

    return new Promise<ServerMessage<T>>((resolve) => {
      this.send(message);

      unlisten = this.onMessage((msg) => {
        if (
          msg.messageType === 'client_response' &&
          msg.clientMessage === message
        ) {
          resolve(msg as ServerMessage<T>);
        }
      });
    }).finally(() => unlisten());
  }

  /** Get all monitors. */
  getMonitors() {
    return this.sendAndWaitReply('monitors');
  }

  /** Get all workspaces. */
  getWorkspaces() {
    return this.sendAndWaitReply('workspaces');
  }

  /** Get all windows. */
  getWindows() {
    return this.sendAndWaitReply('windows');
  }

  /** Close the websocket connection. */
  close(): void {
    this._socket.close();
  }

  /** Register a callback for one or more GlazeWM events. */
  async subscribe<T extends GwmEvent | GwmEvent[]>(
    event: T,
    callback: SubscribeCallback,
  ): Promise<UnlistenFn> {
    const eventsArr = Array.isArray(event) ? event : [event];

    const response = await this.sendAndWaitReply(
      `subscribe -e ${eventsArr.join(',')}`,
    );

    if (response.error) {
      throw new Error(
        `Failed to subscribe to event '${eventsArr}': ${response.error}`,
      );
    }

    const unlisten = this.onMessage((msg) => {
      // TODO: Avoid any cast.
      if (
        msg.messageType === 'subscribed_event' &&
        eventsArr.includes((msg.data as any).type)
      ) {
        callback(msg.data as any);
      }
    });

    // TODO: Properly unsubscribe from the event(s).
    return unlisten;
  }

  /** Register a callback for when any websocket messages are received. */
  onMessage(callback: MessageCallback): UnlistenFn {
    this._onMessageCallbacks.push(callback);

    return () => {
      this._onMessageCallbacks = this._onMessageCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /** Register a callback for when the websocket connects. */
  onConnect(callback: ConnectCallback): UnlistenFn {
    this._onConnectCallbacks.push(callback);

    return () => {
      this._onConnectCallbacks = this._onConnectCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /** Register a callback for when the websocket disconnects. */
  onDisconnect(callback: DisconnectCallback): UnlistenFn {
    this._onDisconnectCallbacks.push(callback);

    return () => {
      this._onDisconnectCallbacks = this._onDisconnectCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /** Register a callback for when the websocket connection errors. */
  onError(callback: ErrorCallback): UnlistenFn {
    this._onErrorCallbacks.push(callback);

    return () => {
      this._onErrorCallbacks = this._onErrorCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /** Register callbacks for socket lifecycle methods. */
  private _registerSocketLifecycle(): void {
    this._socket.onmessage = (e) =>
      this._onMessageCallbacks.forEach((callback) => callback(e.data));

    this._socket.onopen = (e) =>
      this._onConnectCallbacks.forEach((callback) => callback(e));

    this._socket.onerror = (e) =>
      this._onErrorCallbacks.forEach((callback) => callback(e));

    this._socket.onclose = (e) =>
      this._onDisconnectCallbacks.forEach((callback) => callback(e));
  }
}
