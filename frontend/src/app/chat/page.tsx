'use client'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useSocket } from '@/context/SocketContext'
import { useRouter } from 'next/navigation'
import { encryptMessage, decryptMessage, getPrivateKey } from '@/lib/crypto'
import api from '@/lib/api'

interface Message {
  id: string
  ciphertext: string
  senderId: string
  receiverId: string
  senderPublicKey: string
  mediaType?: string | null
  mediaName?: string | null
  createdAt: string
  decrypted?: string
  decryptedMedia?: string  // object URL or base64 data URL
  pending?: boolean
}

interface Contact {
  id: string
  username: string
  publicKey: string
  lastMessage?: { createdAt: string; senderId: string; preview: string }
  unread?: number
}

export default function ChatPage() {
  const { user, logout }                      = useAuth()
  const { sendMessage, onMessage, connected, sendTyping } = useSocket()
  const router                                = useRouter()
  const [contacts,    setContacts]            = useState<Contact[]>([])
  const [selected,    setSelected]            = useState<Contact | null>(null)
  const [messages,    setMessages]            = useState<Message[]>([])
  const [newMsg,      setNewMsg]              = useState('')
  const [search,      setSearch]              = useState('')
  const [results,     setResults]             = useState<Contact[]>([])
  const [loadingMsgs, setLoadingMsgs]         = useState(false)
  const [sending,     setSending]             = useState(false)
  const [isTyping,    setIsTyping]            = useState(false)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)
  const fileRef     = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<Contact | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Encrypt a file: converts to base64 then encrypts as a message
  const encryptFile = async (file: File, recipientPublicKey: string, privateKey: string) => {
    const buffer = await file.arrayBuffer()
    const bytes  = new Uint8Array(buffer)
    // Build base64 in chunks to avoid call stack overflow on large files
    let base64 = ''
    const CHUNK = 8192
    for (let i = 0; i < bytes.length; i += CHUNK) {
      base64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    base64 = btoa(base64)
    return encryptMessage(base64, recipientPublicKey, privateKey)
  }

  // Decrypt a message — returns { decrypted, decryptedMedia }
  const decryptMsg = async (msg: Message, contactPublicKey: string, privateKey: string) => {
    const plain = await decryptMessage(
      msg.ciphertext,
      msg.senderPublicKey || contactPublicKey,
      privateKey
    )
    if (msg.mediaType) {
      const binaryStr = atob(plain)
      const bytes     = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
      const blob = new Blob([bytes], { type: msg.mediaType })
      return { decrypted: msg.mediaName ?? 'file', decryptedMedia: URL.createObjectURL(blob) }
    }
    return { decrypted: plain, decryptedMedia: undefined }
  }

  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => {
    if (!user) router.push('/')
  }, [user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  useEffect(() => {
    if (!user) return
    // Clean up stale messages from previous key sessions
    api.delete('/api/messages/stale').catch(() => {})
    Promise.all([
      api.get('/api/users/contacts'),
      api.get('/api/users/conversations')
    ]).then(([contactsRes, convsRes]) => {
      const contactList: Contact[] = contactsRes.data.contacts
      const convMap = new Map(
        convsRes.data.conversations.map((c: { user: Contact; lastMessage: { createdAt: string; senderId: string } }) => [
          c.user.id,
          { ...c.user, lastMessage: { ...c.lastMessage, preview: '🔒' } }
        ])
      )
      // Sort: contacts with recent messages first
      const withConvs  = contactList
        .map(c => convMap.get(c.id) as Contact || c)
        .sort((a, b) => {
          const ta = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0
          const tb = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0
          return tb - ta
        })
      setContacts(withConvs)
    }).catch(console.error)
  }, [user])

  // Listen for incoming real-time messages
  useEffect(() => {
    onMessage(async (data) => {
      // Handle typing indicator
      if (data.type === 'typing') {
        const current = selectedRef.current
        if (current && data.senderId === current.id) {
          setIsTyping(data.isTyping as boolean)
        }
        return
      }

      if (data.type !== 'new_message') return
      const msg        = data.message as Message & { sender?: { username: string } }
      const privateKey = getPrivateKey()
      if (!privateKey) return

      const current = selectedRef.current

      // Update sidebar: bump to top, set last message, increment unread only if chat is NOT open
      const isOpen = current?.id === msg.senderId
      setContacts(prev => {
        const existing = prev.find(c => c.id === msg.senderId)
        const updated: Contact = {
          ...(existing || { id: msg.senderId, username: msg.sender?.username ?? '', publicKey: msg.senderPublicKey ?? '' }),
          lastMessage: { createdAt: msg.createdAt, senderId: msg.senderId, preview: '🔒' },
          unread: isOpen ? 0 : (existing?.unread ?? 0) + 1
        }
        return [updated, ...prev.filter(c => c.id !== msg.senderId)]
      })

      if (!current || msg.senderId !== current.id) return

      setIsTyping(false)
      try {
        const result = await decryptMsg(msg, current.publicKey, privateKey)
        setMessages(prev => [...prev, { ...msg, ...result }])
      } catch (err) {
        console.error('Decrypt error:', err)
        setMessages(prev => [...prev, { ...msg, decrypted: '[could not decrypt]' }])
      }
    })
  },[])

  // Load chat history with a contact
  const selectContact = async (contact: Contact) => {
    setSelected(contact)
    setMessages([])
    setIsTyping(false)
    setLoadingMsgs(true)
    // Clear unread badge
    setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, unread: 0 } : c))

    try {
      // Fetch fresh public key in case contact re-logged in with new keypair
      const pkRes = await api.get(`/api/users/${contact.id}/publickey`)
      const freshContact = { ...contact, publicKey: pkRes.data.user.publicKey }
      setSelected(freshContact)
      selectedRef.current = freshContact
      setContacts(prev => prev.map(c => c.id === contact.id ? freshContact : c))

      const res        = await api.get(`/api/messages/history/${contact.id}`)
      const privateKey = getPrivateKey()
      if (!privateKey) return

      const decryptedMessages = await Promise.all(
        res.data.messages.map(async (msg: Message) => {
          try {
            const result = await decryptMsg(msg, freshContact.publicKey, privateKey)
            return { ...msg, ...result }
          } catch (err) {
            console.error('Failed to decrypt msg:', msg.id, err)
            return { ...msg, decrypted: '[could not decrypt]' }
          }
        })
      )
      setMessages(decryptedMessages)
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      setLoadingMsgs(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const syncContacts = async () => {
    try {
      // @ts-expect-error contacts API not in TS types yet
      if ('contacts' in navigator && 'ContactsManager' in window) {
        // Mobile browser — use native Contacts API
        // @ts-expect-error contacts API
        const contacts = await navigator.contacts.select(['tel'], { multiple: true })
        const phones   = contacts.flatMap((c: { tel: string[] }) => c.tel)
        if (!phones.length) return
        const res = await api.post('/api/users/match-contacts', { phones })
        const matched: Contact[] = res.data.users
        setContacts(prev => {
          const existingIds = new Set(prev.map(c => c.id))
          return [...prev, ...matched.filter(c => !existingIds.has(c.id))]
        })
        alert(`Found ${matched.length} contact(s) on SecureChat!`)
        // Refresh contacts list
        const contactsRes = await api.get('/api/users/contacts')
        setContacts(contactsRes.data.contacts)
      } else {
        // Desktop fallback — prompt for comma-separated numbers
        const input = prompt('Enter phone numbers separated by commas (e.g. +911234567890, +19876543210):')
        if (!input) return
        const phones = input.split(',').map(p => p.trim()).filter(Boolean)
        const res    = await api.post('/api/users/match-contacts', { phones })
        const matched: Contact[] = res.data.users
        setContacts(prev => {
          const existingIds = new Set(prev.map(c => c.id))
          return [...prev, ...matched.filter(c => !existingIds.has(c.id))]
        })
        alert(matched.length ? `Found ${matched.length} user(s) on SecureChat!` : 'No users found with those numbers.')
        if (matched.length) {
          const contactsRes = await api.get('/api/users/contacts')
          setContacts(contactsRes.data.contacts)
        }
      }
    } catch (err) {
      console.error('Contacts sync failed:', err)
    }
  }

  const handleSearch = async (q: string) => {
    setSearch(q)
    if (q.length < 2) { setResults([]); return }
    try {
      const res = await api.get(`/api/users/search?q=${q}`)
      setResults(res.data.users)
    } catch (err) {
      console.error('Search failed:', err)
    }
  }

  const handleFileSend = async (file: File) => {
    if (!selected || !user) return
    const privateKey = getPrivateKey()
    if (!privateKey) { alert('Private key missing! Please log out and log back in.'); return }

    const MAX = 10 * 1024 * 1024
    if (file.size > MAX) { alert('File too large. Maximum size is 10MB.'); return }

    setSending(true)
    try {
      const pkRes      = await api.get(`/api/users/${selected.id}/publickey`)
      const freshPubKey = pkRes.data.user.publicKey

      const ciphertext = await encryptFile(file, freshPubKey, privateKey)
      sendMessage(selected.id, ciphertext, user.publicKey, file.type, file.name)

      // Preview locally without decrypting
      const localUrl = URL.createObjectURL(file)
      setMessages(prev => [...prev, {
        id:             Date.now().toString(),
        ciphertext,
        senderId:       user.id,
        receiverId:     selected.id,
        senderPublicKey: user.publicKey,
        mediaType:      file.type,
        mediaName:      file.name,
        createdAt:      new Date().toISOString(),
        decrypted:      file.name,
        decryptedMedia: localUrl,
        pending:        true,
      }])

      setContacts(prev => {
        const existing = prev.find(c => c.id === selected.id)
        if (!existing) return prev
        return [{ ...existing, lastMessage: { createdAt: new Date().toISOString(), senderId: user.id, preview: '🔒' } }, ...prev.filter(c => c.id !== selected.id)]
      })
    } catch (err) {
      console.error('File send failed:', err)
      alert('Failed to send file.')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!newMsg.trim() || !selected || !user || sending) return

    const privateKey = getPrivateKey()
    if (!privateKey) {
      alert('Private key missing! Please log out and log back in.')
      return
    }

    setSending(true)
    const msgText = newMsg
    setNewMsg('')

    try {
      // Always fetch recipient's latest public key before encrypting
      const pkRes      = await api.get(`/api/users/${selected.id}/publickey`)
      const freshPubKey = pkRes.data.user.publicKey

      // Update contact in state if key changed
      if (freshPubKey !== selected.publicKey) {
        const updated = { ...selected, publicKey: freshPubKey }
        setSelected(updated)
        selectedRef.current = updated
        setContacts(prev => prev.map(c => c.id === selected.id ? updated : c))
      }

      const ciphertext = await encryptMessage(msgText, freshPubKey, privateKey)

      sendMessage(selected.id, ciphertext, user.publicKey)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      sendTyping(selected.id, false)

      const now = new Date().toISOString()
      // Bump contact to top of sidebar with last message time
      setContacts(prev => {
        const existing = prev.find(c => c.id === selected.id)
        if (!existing) return prev
        const updated = { ...existing, lastMessage: { createdAt: now, senderId: user.id, preview: '🔒' } }
        return [updated, ...prev.filter(c => c.id !== selected.id)]
      })

      // Show message immediately in UI
      setMessages(prev => [...prev, {
        id:              Date.now().toString(),
        ciphertext,
        senderId:        user.id,
        receiverId:      selected.id,
        senderPublicKey: user.publicKey,
        createdAt:       new Date().toISOString(),
        decrypted:       msgText,
        pending:         true,
      }])

      if (!contacts.find(c => c.id === selected.id)) {
        setContacts(prev => [selected, ...prev])
      }
    } catch (err) {
      console.error('Failed to send:', err)
      setNewMsg(msgText)
      alert('Failed to send message. Please try again.')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!user) return null

  return (
    <div className="h-screen bg-gray-950 flex overflow-hidden">

      {/* Sidebar */}
      <div className="w-80 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                {user.username[0].toUpperCase()}
              </div>
              <div>
                <p className="text-white text-sm font-semibold">{user.username}</p>
                <p className={`text-xs ${connected ? 'text-green-400' : 'text-yellow-400'}`}>
                  {connected ? '● Online' : '● Connecting...'}
                </p>
              </div>
            </div>
            <button
              onClick={() => { logout(); router.push('/') }}
              className="text-gray-400 hover:text-red-400 text-xs transition-colors px-2 py-1 rounded hover:bg-gray-800"
            >
              Logout
            </button>
          </div>

          <input
            type="text"
            placeholder="🔍 Search by name or +phone..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none placeholder-gray-500"
          />

          <button
            onClick={syncContacts}
            className="w-full mt-2 flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-sm transition-colors border border-gray-700"
          >
            <span>👥</span> Find contacts on SecureChat
          </button>

          {results.length > 0 && (
            <div className="mt-1 bg-gray-800 rounded-lg overflow-hidden border border-gray-700 shadow-xl">
              {results.map(u => (
                <button key={u.id}
                  onClick={async () => {
                    // Add to contacts then open chat
                    await api.post('/api/users/contacts/add', { contactId: u.id }).catch(() => {})
                    selectContact(u)
                    setSearch('')
                    setResults([])
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-700 text-white text-sm flex items-center gap-2 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold">
                    {u.username[0].toUpperCase()}
                  </div>
                  {u.username}
                </button>
              ))}
            </div>
          )}
          {search.length >= 2 && results.length === 0 && (
            <p className="text-gray-500 text-xs mt-2 text-center">No users found</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <div className="text-center mt-12 px-4">
              <p className="text-3xl mb-2">💬</p>
              <p className="text-gray-400 text-sm">No conversations yet</p>
              <p className="text-gray-600 text-xs mt-1">Search for a user to start chatting</p>
            </div>
          ) : (
            contacts.map(contact => (
              <button key={contact.id}
                onClick={() => selectContact(contact)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-800 transition-colors border-b border-gray-800/50 ${
                  selected?.id === contact.id ? 'bg-gray-800 border-r-2 border-blue-500' : ''
                }`}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold">
                    {contact.username[0].toUpperCase()}
                  </div>
                  {(contact.unread ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
                      {contact.unread! > 9 ? '9+' : contact.unread}
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center justify-between">
                    <p className="text-white text-sm font-medium truncate">{contact.username}</p>
                    {contact.lastMessage && (
                      <span className="text-gray-500 text-xs flex-shrink-0 ml-1">
                        {new Date(contact.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {contact.lastMessage?.senderId === user.id && (
                      <span className="text-blue-400 text-xs">✓✓</span>
                    )}
                    <p className="text-gray-500 text-xs truncate">
                      {contact.lastMessage ? '🔒 Encrypted message' : '🔒 Encrypted conversation'}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <>
            <div className="px-5 py-3 bg-gray-900 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold">
                {selected.username[0].toUpperCase()}
              </div>
              <div>
                <p className="text-white font-semibold">{selected.username}</p>
                <p className="text-green-400 text-xs">🔒 End-to-end encrypted</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
              {loadingMsgs ? (
                <div className="flex justify-center items-center h-full">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"/>
                    <p className="text-gray-400 text-sm">Loading messages...</p>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex justify-center items-center h-full">
                  <div className="text-center">
                    <p className="text-4xl mb-2">🔒</p>
                    <p className="text-gray-400 text-sm">No messages yet</p>
                    <p className="text-gray-600 text-xs mt-1">Say hello to {selected.username}!</p>
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isMine = msg.senderId === user.id
                  const showTime = i === messages.length - 1 ||
                    messages[i + 1]?.senderId !== msg.senderId

                  return (
                    <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-xs lg:max-w-md xl:max-w-lg">
                        <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          isMine
                            ? 'bg-blue-600 text-white rounded-br-sm'
                            : 'bg-gray-800 text-white rounded-bl-sm'
                        } ${msg.pending ? 'opacity-70' : ''}`}>
                          {msg.decryptedMedia ? (
                            msg.mediaType?.startsWith('image/') ? (
                              <img
                                src={msg.decryptedMedia}
                                alt={msg.mediaName ?? 'image'}
                                className="max-w-xs rounded-xl cursor-pointer"
                                onClick={() => window.open(msg.decryptedMedia, '_blank')}
                              />
                            ) : (
                              <a href={msg.decryptedMedia} download={msg.mediaName}
                                className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                                <span className="text-2xl">
                                  {msg.mediaType?.startsWith('video/') ? '🎬'
                                    : msg.mediaType?.includes('pdf') ? '📄'
                                    : '📎'}
                                </span>
                                <div>
                                  <p className="font-medium text-sm truncate max-w-[180px]">{msg.mediaName}</p>
                                  <p className="text-xs opacity-70">Tap to download</p>
                                </div>
                              </a>
                            )
                          ) : (
                            <p className="break-words">{msg.decrypted}</p>
                          )}
                        </div>
                        {showTime && (
                          <div className={`flex items-center gap-1 mt-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <p className="text-gray-600 text-xs">
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: '2-digit', minute: '2-digit'
                              })}
                            </p>
                            {isMine && (
                              <span className={`text-xs ${msg.pending ? 'text-gray-600' : 'text-blue-400'}`}>
                                {msg.pending ? '○' : '✓✓'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
                  </div>
                </div>
              )}
              <div ref={bottomRef}/>
            </div>

            <div className="p-4 bg-gray-900 border-t border-gray-800 flex-shrink-0">
              <form onSubmit={handleSend} className="flex gap-2 items-end">
                {/* Hidden file input */}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSend(f); e.target.value = '' }}
                />
                {/* Paperclip button */}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={sending}
                  className="text-gray-400 hover:text-blue-400 transition-colors p-2 rounded-xl hover:bg-gray-800 flex-shrink-0"
                  title="Send file"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  value={newMsg}
                  onChange={e => {
                    setNewMsg(e.target.value)
                    if (!selected) return
                    sendTyping(selected.id, true)
                    if (typingTimer.current) clearTimeout(typingTimer.current)
                    typingTimer.current = setTimeout(() => sendTyping(selected.id, false), 2000)
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${selected.username}...`}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:border-blue-500 focus:outline-none text-sm placeholder-gray-500"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={!newMsg.trim() || sending}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl px-5 py-3 text-sm font-medium transition-all flex items-center gap-2 flex-shrink-0"
                >
                  {sending ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                  ) : 'Send ↵'}
                </button>
              </form>
              <p className="text-gray-700 text-xs mt-2 text-center">
                🔒 Only you and {selected.username} can read these messages
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-7xl mb-4">🔒</div>
              <h2 className="text-white text-xl font-semibold mb-2">SecureChat</h2>
              <p className="text-gray-400 text-sm">Select a conversation or search for a user</p>
              <p className="text-gray-600 text-xs mt-2 max-w-xs">
                All messages are end-to-end encrypted. Not even the server can read them.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}