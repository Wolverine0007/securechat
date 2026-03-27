require('dotenv').config()
const fastify = require('fastify')({ logger: true })

// Register plugins
fastify.register(require('@fastify/cors'), {
  origin: [
    'http://localhost:3000',
    /\.amplifyapp\.com$/,     // AWS Amplify domains
    /\.cloudfront\.net$/,     // CloudFront domains
    process.env.FRONTEND_URL  // custom domain if set
  ].filter(Boolean),
  credentials: true
})

fastify.register(require('@fastify/jwt'), {
  secret: process.env.JWT_SECRET
})

fastify.register(require('@fastify/websocket'), {
  options: { maxPayload: 15 * 1024 * 1024 } // 15MB max WebSocket message
})

// Register routes
fastify.register(require('./routes/auth'),     { prefix: '/api/auth' })
fastify.register(require('./routes/users'),    { prefix: '/api/users' })
fastify.register(require('./routes/messages'), { prefix: '/api/messages' })
fastify.register(require('./routes/ws'))

// Health check
fastify.get('/health', async () => ({ status: 'ok' }))

const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3001, host: '0.0.0.0' })
    console.log('🚀 Server running on http://localhost:3001')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()