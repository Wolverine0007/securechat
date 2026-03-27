'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'

interface MessageData {
  type: string
  [key: string]: unknown
}

interface SocketContextType {
  socket: WebSocket | null
  connected: boolean
  sendMessage: (receiverId: string, ciphertext: string, senderPublicKey: string, mediaType?: string, mediaName?: string) => void
  sendTyping: (receiverId: string, isTyping: boolean) => void
  onMessage: (callback: (data: MessageData) => void) => void
}

const SocketContext = createContext<SocketContextType>({} as SocketContextType)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  const socketRef   = useRef<WebSocket | null>(null)
  const callbackRef = useRef<((data: MessageData) => void) | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!token) return

    function connect() {
      const ws = new WebSocket('ws://localhost:3001/ws')
      socketRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }))
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.type === 'auth_success') setConnected(true)
        // Always call the latest registered callback
        callbackRef.current?.(data)
      }

      ws.onclose = () => {
        setConnected(false)
        socketRef.current = null
        // Auto-reconnect after 2 seconds
        reconnectTimer.current = setTimeout(connect, 2000)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      socketRef.current?.close()
    }
  }, [token])

  const sendMessage = (receiverId: string, ciphertext: string, senderPublicKey: string, mediaType?: string, mediaName?: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'message', receiverId, ciphertext, senderPublicKey,
        ...(mediaType ? { mediaType, mediaName } : {})
      }))
    }
  }

  const sendTyping = (receiverId: string, isTyping: boolean) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'typing', receiverId, isTyping }))
    }
  }

  const onMessage = (callback: (data: MessageData) => void) => {
    callbackRef.current = callback
  }

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected, sendMessage, sendTyping, onMessage }}>
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => useContext(SocketContext)