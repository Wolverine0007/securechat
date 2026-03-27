const { prisma, authenticate } = require('../middleware/authenticate')

module.exports = async function (fastify) {

  // Send a message (store encrypted ciphertext)
  fastify.post('/send', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const { receiverId, ciphertext } = request.body
    const senderId = request.user.userId

    if (!receiverId || !ciphertext) {
      return reply.status(400).send({ error: 'receiverId and ciphertext are required' })
    }

    // Make sure receiver exists
    const receiver = await prisma.user.findUnique({ where: { id: receiverId } })
    if (!receiver) return reply.status(404).send({ error: 'Receiver not found' })

    // Save the encrypted message — we never see the real content
    const message = await prisma.message.create({
      data: { senderId, receiverId, ciphertext },
      include: {
        sender:   { select: { id: true, username: true } },
        receiver: { select: { id: true, username: true } }
      }
    })

    return reply.status(201).send({ message })
  })

  // Delete messages that can no longer be decrypted (sender key changed)
  fastify.delete('/stale', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const userId = request.user.userId
    await prisma.$executeRaw`
      DELETE FROM "Message" m
      USING "User" u
      WHERE m."senderId" = u.id
      AND m."senderPublicKey" != u."publicKey"
      AND m."senderPublicKey" != ''
      AND (m."senderId" = ${userId} OR m."receiverId" = ${userId})
    `
    return reply.send({ ok: true })
  })

  // Get message history between two users
  fastify.get('/history/:otherUserId', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const userId = request.user.userId
    const { otherUserId } = request.params

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId,      receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId }
        ]
      },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, username: true } }
      }
    })

    return reply.send({ messages })
  })
}