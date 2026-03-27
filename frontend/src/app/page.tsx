'use client'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'

type Step = 'auth' | 'otp' | 'forgot' | 'reset'

export default function HomePage() {
  const [isLogin,   setIsLogin]   = useState(true)
  const [step,      setStep]      = useState<Step>('auth')

  // Fields
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [username,  setUsername]  = useState('')
  const [phone,     setPhone]     = useState('')
  const [otp,       setOtp]       = useState(['', '', '', '', '', ''])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [otpTimer,  setOtpTimer]  = useState(0)

  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  const { login, signup, user, loading: authLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && user) router.push('/chat')
  }, [user, authLoading])

  // Countdown timer for OTP resend
  useEffect(() => {
    if (otpTimer <= 0) return
    const t = setTimeout(() => setOtpTimer(v => v - 1), 1000)
    return () => clearTimeout(t)
  }, [otpTimer])

  const resetToAuth = () => {
    setStep('auth'); setError(''); setOtp(['', '', '', '', '', '']); setNewPassword(''); setConfirmPassword('')
  }

  // Forgot password — send OTP
  const handleForgotSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email) { setError('Email is required'); return }
    setLoading(true)
    try {
      await api.post('/api/auth/forgot-password', { email })
      setStep('reset')
      setOtpTimer(60)
      setTimeout(() => otpRefs.current[0]?.focus(), 100)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      setError(e.response?.data?.error || 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  // Reset password — verify OTP + set new password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const otpCode = otp.join('')
    if (otpCode.length < 6)              { setError('Enter the 6-digit code'); return }
    if (newPassword.length < 6)          { setError('Password must be at least 6 characters'); return }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      await api.post('/api/auth/reset-password', { email, otp: otpCode, newPassword })
      setStep('auth')
      setIsLogin(true)
      setOtp(['', '', '', '', '', ''])
      setNewPassword('')
      setConfirmPassword('')
      setError('')
      alert('Password reset! Please log in with your new password.')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      setError(e.response?.data?.error || 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  // Step 1: send OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email) { setError('Email is required'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (username.length < 3) { setError('Username must be at least 3 characters'); return }

    setLoading(true)
    try {
      await api.post('/api/auth/send-otp', { email })
      setStep('otp')
      setOtpTimer(60)
      setTimeout(() => otpRefs.current[0]?.focus(), 100)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      setError(e.response?.data?.error || 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: verify OTP + create account
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const otpCode = otp.join('')
    if (otpCode.length < 6) { setError('Enter the 6-digit code'); return }

    setLoading(true)
    try {
      await signup(username, email, password, phone, otpCode)
      router.push('/chat')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      setError(e.response?.data?.error || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  // Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true)
    try {
      await login(email, password)
      router.push('/chat')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      setError(e.response?.data?.error || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  // OTP input box handler
  const handleOtpChange = (i: number, val: string) => {
    if (!/^\d*$/.test(val)) return
    const next = [...otp]
    next[i] = val.slice(-1)
    setOtp(next)
    if (val && i < 5) otpRefs.current[i + 1]?.focus()
  }

  const handleOtpKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus()
  }

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 6) {
      setOtp(text.split(''))
      otpRefs.current[5]?.focus()
    }
  }

  if (authLoading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-md border border-gray-800 shadow-2xl">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🔒</div>
          <h1 className="text-2xl font-bold text-white">SecureChat</h1>
          <p className="text-gray-400 text-sm mt-1">End-to-end encrypted messaging</p>
        </div>

        {/* Forgot Password — Enter Email */}
        {step === 'forgot' && (
          <div>
            <button onClick={resetToAuth} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-6 transition-colors">← Back</button>
            <h2 className="text-white font-semibold text-lg mb-1">Forgot Password</h2>
            <p className="text-gray-400 text-sm mb-6">Enter your registered email and we'll send a reset code.</p>
            <form onSubmit={handleForgotSendOtp} className="space-y-4">
              <input type="email" placeholder="Email address" value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:border-yellow-500 focus:outline-none placeholder-gray-500"
                required />
              {error && (
                <div className="flex items-start gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-xl p-3">
                  <span>⚠️</span><span>{error}</span>
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-700 disabled:text-gray-500 text-black font-semibold rounded-xl py-3 transition-colors flex items-center justify-center gap-2">
                {loading ? <><div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"/>Sending...</> : 'Send Reset Code →'}
              </button>
            </form>
          </div>
        )}

        {/* Reset Password — OTP + New Password */}
        {step === 'reset' && (
          <div>
            <button onClick={resetToAuth} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-6 transition-colors">← Back</button>
            <h2 className="text-white font-semibold text-lg mb-1">Reset Password</h2>
            <p className="text-gray-400 text-sm mb-6">
              Enter the code sent to <span className="text-yellow-400">{email}</span> and your new password.
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="flex gap-2 justify-between" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input key={i} ref={el => { otpRefs.current[i] = el }}
                    type="text" inputMode="numeric" maxLength={1} value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold bg-gray-800 text-white rounded-xl border border-gray-700 focus:border-yellow-500 focus:outline-none transition-colors"
                  />
                ))}
              </div>
              <input type="password" placeholder="New password (min 6 chars)" value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:border-yellow-500 focus:outline-none placeholder-gray-500"
                required />
              <input type="password" placeholder="Confirm new password" value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:border-yellow-500 focus:outline-none placeholder-gray-500"
                required />
              {error && (
                <div className="flex items-start gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-xl p-3">
                  <span>⚠️</span><span>{error}</span>
                </div>
              )}
              <button type="submit" disabled={loading || otp.join('').length < 6}
                className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-700 disabled:text-gray-500 text-black font-semibold rounded-xl py-3 transition-colors flex items-center justify-center gap-2">
                {loading ? <><div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"/>Resetting...</> : 'Reset Password'}
              </button>
              <p className="text-center text-sm text-gray-500">
                {otpTimer > 0
                  ? <>Resend in <span className="text-yellow-400">{otpTimer}s</span></>
                  : <button type="button" onClick={() => { api.post('/api/auth/forgot-password', { email }); setOtpTimer(60) }} className="text-yellow-400 hover:text-yellow-300">Resend code</button>
                }
              </p>
            </form>
          </div>
        )}

        {/* OTP Step (signup) */}
        {step === 'otp' && (
          <div>
            <button onClick={resetToAuth} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-6 transition-colors">
              ← Back
            </button>
            <h2 className="text-white font-semibold text-lg mb-1">Check your email</h2>
            <p className="text-gray-400 text-sm mb-6">
              We sent a 6-digit code to <span className="text-blue-400">{email}</span>
            </p>

            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div className="flex gap-2 justify-between" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { otpRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold bg-gray-800 text-white rounded-xl border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
                  />
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-xl p-3">
                  <span>⚠️</span><span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading || otp.join('').length < 6}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl py-3 font-medium transition-colors flex items-center justify-center gap-2">
                {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Verifying...</> : 'Verify & Create Account'}
              </button>

              <p className="text-center text-sm text-gray-500">
                {otpTimer > 0 ? (
                  <>Resend code in <span className="text-blue-400">{otpTimer}s</span></>
                ) : (
                  <button type="button" onClick={() => { api.post('/api/auth/send-otp', { email }); setOtpTimer(60) }}
                    className="text-blue-400 hover:text-blue-300 transition-colors">
                    Resend code
                  </button>
                )}
              </p>
            </form>
          </div>
        )}

        {/* Auth Step (Login / Signup) */}
        {step === 'auth' && (
          <>
            <div className="flex bg-gray-800 rounded-xl p-1 mb-6">
              <button onClick={() => { setIsLogin(true); setError('') }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${isLogin ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                Login
              </button>
              <button onClick={() => { setIsLogin(false); setError('') }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${!isLogin ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                Sign Up
              </button>
            </div>

            <form onSubmit={isLogin ? handleLogin : handleSendOtp} className="space-y-3">
              {!isLogin && (
                <>
                  <input type="text" placeholder="Username (min 3 chars)" value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:border-blue-500 focus:outline-none placeholder-gray-500"
                    required />
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">📱</span>
                    <input type="tel" placeholder="Phone number (optional, e.g. +91...)"
                      value={phone} onChange={e => setPhone(e.target.value)}
                      className="w-full bg-gray-800 text-white rounded-xl pl-10 pr-4 py-3 border border-gray-700 focus:border-blue-500 focus:outline-none placeholder-gray-500" />
                  </div>
                </>
              )}

              <input type="email" placeholder="Email address" value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:border-blue-500 focus:outline-none placeholder-gray-500"
                required />
              <input type="password" placeholder="Password (min 6 chars)" value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:border-blue-500 focus:outline-none placeholder-gray-500"
                required />

              {!isLogin && (
                <p className="text-xs text-gray-500 flex items-center gap-1.5 px-1">
                  <span>✉️</span> We'll send a verification code to your email
                </p>
              )}

              {error && (
                <div className="flex items-start gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-xl p-3">
                  <span>⚠️</span><span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-xl py-3 font-medium transition-colors flex items-center justify-center gap-2 mt-2">
                {loading
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Please wait...</>
                  : isLogin ? 'Login' : 'Send Verification Code →'
                }
              </button>

              {isLogin && (
                <p className="text-center">
                  <button type="button"
                    onClick={() => { setStep('forgot'); setError('') }}
                    className="text-gray-500 hover:text-blue-400 text-sm transition-colors">
                    Forgot password?
                  </button>
                </p>
              )}
            </form>
          </>
        )}

        <div className="mt-6 p-3 bg-gray-800/50 rounded-xl border border-gray-700/50">
          <p className="text-center text-gray-500 text-xs leading-relaxed">
            🔒 Your messages are encrypted on your device. Nobody can read your conversations.
          </p>
        </div>
      </div>
    </div>
  )
}
