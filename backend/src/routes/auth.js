const bcrypt      = require('bcryptjs')
const nodemailer  = require('nodemailer')
const { prisma }  = require('../middleware/authenticate')

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
})

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function sendOtpEmail(email, otp) {
  await transporter.sendMail({
    from:    process.env.SMTP_FROM,
    to:      email,
    subject: 'SecureChat — Your verification code',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:32px;background:#111;border-radius:16px;color:#fff">
        <div style="text-align:center;font-size:40px;margin-bottom:16px">🔒</div>
        <h2 style="text-align:center;margin:0 0 8px">SecureChat</h2>
        <p style="color:#aaa;text-align:center;margin:0 0 32px">Your verification code</p>
        <div style="background:#1e1e2e;border-radius:12px;padding:24px;text-align:center;letter-spacing:12px;font-size:36px;font-weight:bold;color:#3b82f6">
          ${otp}
        </div>
        <p style="color:#666;text-align:center;font-size:13px;margin-top:24px">
          This code expires in 10 minutes. Do not share it with anyone.
        </p>
      </div>
    `
  })
}

module.exports = async function (fastify) {

  // STEP 1: Send OTP to email before signup
  fastify.post('/send-otp', async (request, reply) => {
    const { email } = request.body
    if (!email) return reply.status(400).send({ error: 'Email is required' })

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return reply.status(400).send({ error: 'Email already registered' })

    const otp       = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 min

    // Delete any previous OTPs for this email
    await prisma.otpCode.deleteMany({ where: { email } })
    await prisma.otpCode.create({ data: { id: crypto.randomUUID(), email, code: otp, expiresAt } })

    try {
      await sendOtpEmail(email, otp)
      return reply.send({ message: 'OTP sent to your email' })
    } catch (err) {
      // In dev: log OTP to console so you can test without SMTP
      console.log(`\n📧 OTP for ${email}: ${otp}\n`)
      return reply.send({ message: 'OTP sent to your email' })
    }
  })

  // STEP 2: Verify OTP + create account
  fastify.post('/signup', async (request, reply) => {
    const { username, email, phone, password, otp, publicKey } = request.body

    if (!username || !email || !password || !otp || !publicKey) {
      return reply.status(400).send({ error: 'All fields are required' })
    }

    // Verify OTP
    const record = await prisma.otpCode.findFirst({
      where: { email, code: otp }
    })
    if (!record)                        return reply.status(400).send({ error: 'Invalid OTP' })
    if (record.expiresAt < new Date())  return reply.status(400).send({ error: 'OTP expired. Request a new one.' })

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }, ...(phone ? [{ phone }] : [])] }
    })
    if (existing) return reply.status(400).send({ error: 'Username, email or phone already taken' })

    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: { username, email, phone: phone || null, password: hashedPassword, publicKey, verified: true }
    })

    await prisma.otpCode.deleteMany({ where: { email } })

    const token = fastify.jwt.sign(
      { userId: user.id, username: user.username },
      { expiresIn: '7d' }
    )

    return reply.status(201).send({
      token,
      user: { id: user.id, username: user.username, email: user.email, phone: user.phone, publicKey: user.publicKey }
    })
  })

  // FORGOT PASSWORD — Step 1: send OTP to registered email
  fastify.post('/forgot-password', async (request, reply) => {
    const { email } = request.body
    if (!email) return reply.status(400).send({ error: 'Email is required' })

    const user = await prisma.user.findUnique({ where: { email } })
    // Always return success to prevent email enumeration
    if (!user) return reply.send({ message: 'If that email is registered, a code has been sent.' })

    const otp       = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await prisma.otpCode.deleteMany({ where: { email } })
    await prisma.otpCode.create({ data: { id: crypto.randomUUID(), email, code: otp, expiresAt } })

    try {
      await transporter.sendMail({
        from:    process.env.SMTP_FROM,
        to:      email,
        subject: 'SecureChat — Reset your password',
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:32px;background:#111;border-radius:16px;color:#fff">
            <div style="text-align:center;font-size:40px;margin-bottom:16px">🔑</div>
            <h2 style="text-align:center;margin:0 0 8px">Reset Password</h2>
            <p style="color:#aaa;text-align:center;margin:0 0 32px">Use this code to reset your SecureChat password</p>
            <div style="background:#1e1e2e;border-radius:12px;padding:24px;text-align:center;letter-spacing:12px;font-size:36px;font-weight:bold;color:#f59e0b">
              ${otp}
            </div>
            <p style="color:#666;text-align:center;font-size:13px;margin-top:24px">
              Expires in 10 minutes. If you didn't request this, ignore this email.
            </p>
          </div>
        `
      })
    } catch {
      console.log(`\n🔑 Reset OTP for ${email}: ${otp}\n`)
    }

    return reply.send({ message: 'If that email is registered, a code has been sent.' })
  })

  // FORGOT PASSWORD — Step 2: verify OTP + set new password
  fastify.post('/reset-password', async (request, reply) => {
    const { email, otp, newPassword } = request.body
    if (!email || !otp || !newPassword) {
      return reply.status(400).send({ error: 'Email, OTP and new password are required' })
    }
    if (newPassword.length < 6) {
      return reply.status(400).send({ error: 'Password must be at least 6 characters' })
    }

    const record = await prisma.otpCode.findFirst({ where: { email, code: otp } })
    if (!record)                       return reply.status(400).send({ error: 'Invalid OTP' })
    if (record.expiresAt < new Date()) return reply.status(400).send({ error: 'OTP expired. Request a new one.' })

    const hashedPassword = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { email }, data: { password: hashedPassword } })
    await prisma.otpCode.deleteMany({ where: { email } })

    return reply.send({ message: 'Password reset successfully. Please log in.' })
  })

  // LOGIN
  fastify.post('/login', async (request, reply) => {
    const { email, password, publicKey } = request.body

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' })
    }

    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) return reply.status(401).send({ error: 'Invalid email or password' })

    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) return reply.status(401).send({ error: 'Invalid email or password' })

    // Only update public key if it changed (new device or after logout)
    if (publicKey && publicKey !== user.publicKey) {
      user = await prisma.user.update({ where: { id: user.id }, data: { publicKey } })
    }

    const token = fastify.jwt.sign(
      { userId: user.id, username: user.username },
      { expiresIn: '7d' }
    )

    return reply.send({
      token,
      user: { id: user.id, username: user.username, email: user.email, phone: user.phone, publicKey: user.publicKey }
    })
  })

  // GET current user
  fastify.get('/me', {
    preHandler: [require('../middleware/authenticate').authenticate]
  }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where:  { id: request.user.userId },
      select: { id: true, username: true, email: true, phone: true, publicKey: true, createdAt: true }
    })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return reply.send({ user })
  })
}
