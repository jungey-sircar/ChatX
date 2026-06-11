import Constants from 'expo-constants';
import { Platform } from 'react-native';

type MessageHandler = (data: any) => void;

class SocketService {
  private socket: WebSocket | null = null;
  private userId: string | null = null;
  private token: string | null = null;
  private listeners: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private isManualDisconnect = false;

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  get currentUserId(): string | null {
    return this.userId;
  }

  connect(userId: string, token: string) {
    // Prevent duplicate connections
    if (this.isConnecting || (this.isConnected && this.userId === userId)) {
      console.log('[Socket] Already connected or connecting');
      return;
    }

    // Close existing connection if any
    if (this.socket) {
      this.isManualDisconnect = true;
      this.socket.close();
      this.socket = null;
    }

    this.userId = userId;
    this.token = token;
    this.isConnecting = true;
    this.isManualDisconnect = false;

    const API_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || '';
    
    let wsUrl: string;
    if (Platform.OS === 'web') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/api/ws/${userId}?token=${token}`;
    } else {
      wsUrl = `${API_URL.replace('https://', 'wss://').replace('http://', 'ws://')}/api/ws/${userId}?token=${token}`;
    }

    console.log('[Socket] Connecting to:', wsUrl.substring(0, 60) + '...');
    
    try {
      this.socket = new WebSocket(wsUrl);
    } catch (error) {
      console.error('[Socket] Failed to create WebSocket:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      console.log('[Socket] Connected successfully');
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.emit('_connected', { userId });
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const msgType = data.type;
        
        // Dispatch to type-specific listeners
        if (msgType) {
          const handlers = this.listeners.get(msgType);
          if (handlers) {
            handlers.forEach(callback => {
              try {
                callback(data);
              } catch (err) {
                console.error(`[Socket] Error in handler for "${msgType}":`, err);
              }
            });
          }
        }
        
        // Also dispatch to wildcard listeners
        const wildcardHandlers = this.listeners.get('*');
        if (wildcardHandlers) {
          wildcardHandlers.forEach(callback => {
            try {
              callback(data);
            } catch (err) {
              console.error('[Socket] Error in wildcard handler:', err);
            }
          });
        }
      } catch (error) {
        console.error('[Socket] Error parsing message:', error);
      }
    };

    this.socket.onclose = (event) => {
      console.log('[Socket] Disconnected, code:', event.code);
      this.isConnecting = false;
      this.emit('_disconnected', { code: event.code });
      
      if (!this.isManualDisconnect) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (error: any) => {
      // Use warn instead of error to avoid red-box overlay in Expo Go.
      // WebSocket errors are expected (e.g., network issues) and the
      // reconnect logic in onclose handles them.
      const msg = error?.message || error?.type || 'connection error';
      console.warn('[Socket] Error:', msg);
      this.isConnecting = false;
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts && this.userId && this.token) {
      this.reconnectAttempts++;
      const delay = Math.min(2000 * this.reconnectAttempts, 15000);
      console.log(`[Socket] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
      
      this.reconnectTimeout = setTimeout(() => {
        if (this.userId && this.token && !this.isManualDisconnect) {
          this.connect(this.userId, this.token);
        }
      }, delay);
    }
  }

  disconnect() {
    console.log('[Socket] Manual disconnect');
    this.isManualDisconnect = true;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.userId = null;
    this.token = null;
    this.reconnectAttempts = 0;
    this.isConnecting = false;
  }

  // Send a raw message object
  send(message: Record<string, any>) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return true;
    } else {
      console.warn('[Socket] Cannot send - not connected');
      return false;
    }
  }

  // Send a typed message with data
  sendTyped(type: string, data: Record<string, any>) {
    return this.send({ type, ...data });
  }

  // Chat-specific helpers
  sendMessage(receiverId: string, content: string, messageType: string = 'text', groupId?: string) {
    const ok = this.send({
      type: 'message',
      data: {
        receiver_id: receiverId,
        content,
        message_type: messageType,
        group_id: groupId,
      },
    });

    // If socket is down, fall back to REST so the message still gets stored
    // and pushed to the receiver via the backend's WebSocket broadcast.
    if (!ok) {
      console.log('[Socket] Falling back to REST for sendMessage');
      // Lazy-import to avoid circular dep
      import('./api')
        .then(({ default: api }) => {
          const body: Record<string, any> = {
            content,
            message_type: messageType,
          };
          if (groupId) body.group_id = groupId;
          else body.receiver_id = receiverId;
          return api.post('/messages', body);
        })
        .catch((err) => {
          console.warn('[Socket] REST fallback failed:', err?.message || err);
        });
    }
    return ok;
  }

  sendTyping(receiverId: string) {
    this.send({ type: 'typing', receiver_id: receiverId });
  }

  // Register event handler
  on(event: string, callback: MessageHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  // Unregister event handler
  off(event: string, callback: MessageHandler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(callback);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  // Emit to local listeners only (not over WebSocket)
  private emit(event: string, data: any) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`[Socket] Error in emit handler for "${event}":`, err);
        }
      });
    }
  }
}

export const socketService = new SocketService();
