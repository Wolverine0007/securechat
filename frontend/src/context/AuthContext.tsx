'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { generateKeyPair, savePrivateKey, clearPrivateKey } from '@/lib/crypto'
import api from '@/lib/api'

interface User {
  id: string
  username: string
  email: string
  publicKey: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  signup: (username: string, email: string, password: string, phone: string, otp: string) => Promise<void>
  logout: () => void
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [token,   setToken]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // On app load, check if user is already logged in
  useEffect(() => {
    const savedToken = localStorage.getItem('token')
    const savedUser  = localStorage.getItem('user')
    if (savedToken && savedUser) {
      setToken(savedToken)
      setUser(JSON.parse(savedUser))
    }
    setLoading(false)
  }, [])

  const signup = async (username: string, email: string, password: string, phone: string, otp: string) => {
    const { publicKey, privateKey } = await generateKeyPair()

    const res = await api.post('/api/auth/signup', {
      username, email, phone, password, otp, publicKey
    })

    const { token, user } = res.data

    savePrivateKey(privateKey)
    localStorage.setItem('publicKey', publicKey)
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
    setToken(token)
    setUser(user)
  }

  const login = async (email: string, password: string) => {
    // Check if we have a keypair stored from a previous session on this device
    const storedPrivateKey = localStorage.getItem('privateKey')
    const storedPublicKey  = localStorage.getItem('publicKey')

    let privateKey: string
    let publicKey:  string

    if (storedPrivateKey && storedPublicKey) {
      // Reuse the existing keypair — keys were generated together so they match
      privateKey = storedPrivateKey
      publicKey  = storedPublicKey
    } else {
      // No keypair on this device — generate fresh
      const kp  = await generateKeyPair()
      privateKey = kp.privateKey
      publicKey  = kp.publicKey
    }

    const res = await api.post('/api/auth/login', { email, password, publicKey })
    const { token, user } = res.data

    savePrivateKey(privateKey)
    localStorage.setItem('publicKey', publicKey)
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
    setToken(token)
    setUser(user)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('publicKey')
    clearPrivateKey()
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, login, signup, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)