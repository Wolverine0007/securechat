const { prisma, authenticate } = require('../middleware/authenticate')

module.exports = async function (fastify) {

  // Add a user to your contacts
  fastify.post('/contacts/add', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const ownerId   = request.user.userId
    const { contactId } = request.body
    if (!contactId) return reply.status(400).send({ error: 'contactId is required' })
    if (contactId === ownerId) return reply.status(400).send({ error: 'Cannot add yourself' })

    const target = await prisma.user.findUnique({ where: { id: contactId } })
    if (!target) return reply.status(404).send({ error: 'User not found' })

    await prisma.contact.upsert({
      where:  { ownerId_contactId: { ownerId, contactId } },
      update: {},
      create: { id: crypto.randomUUID(), ownerId, contactId }
    })

    return reply.send({ user: { id: target.id, username: target.username, publicKey: target.publicKey } })
  })

  // Get your contact list
  fastify.get('/contacts', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const ownerId = request.user.userId

    const contacts = await prisma.contact.findMany({
      where:   { ownerId },
      include: { contactUser: { select: { id: true, username: true, publicKey: true, phone: true } } },
      orderBy: { createdAt: 'asc' }
    })

    return reply.send({ contacts: contacts.map(c => c.contactUser) })
  })

  // Match phone numbers — adds matched users to contacts automatically
  fastify.post('/match-contacts', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const ownerId = request.user.userId
    const { phones } = request.body
    if (!Array.isArray(phones) || phones.length === 0) {
      return reply.status(400).send({ error: 'phones array is required' })
    }

    const normalized = phones.map(p => p.replace(/[\s\-()]/g, ''))

    const users = await prisma.user.findMany({
      where: { phone: { in: normalized }, verified: true, NOT: { id: ownerId } },
      select: { id: true, username: true, phone: true, publicKey: true }
    })

    // Auto-add matched users to contacts
    for (const u of users) {
      await prisma.contact.upsert({
        where:  { ownerId_contactId: { ownerId, contactId: u.id } },
        update: {},
        create: { id: crypto.randomUUID(), ownerId, contactId: u.id }
      })
    }

    return reply.send({ users })
  })

  // Search — by username within contacts, OR by phone to find new contacts
  fastify.get('/search', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const { q } = request.query
    if (!q || q.length < 2) return reply.status(400).send({ error: 'Query must be at least 2 characters' })

    const ownerId   = request.user.userId
    const isPhone   = /^[+\d]/.test(q)  // starts with + or digit = phone search

    if (isPhone) {
      // Phone search — find any registered user with that number (to add as contact)
      const normalized = q.replace(/[\s\-()]/g, '')
      const users = await prisma.user.findMany({
        where: {
          phone:    { startsWith: normalized },
          verified: true,
          NOT:      { id: ownerId }
        },
        select: { id: true, username: true, publicKey: true, phone: true },
        take: 10
      })
      return reply.send({ users })
    }

    // Username search — only within existing contacts
    const myContacts = await prisma.contact.findMany({
      where:  { ownerId },
      select: { contactId: true }
    })
    const contactIds = myContacts.map(c => c.contactId)
    if (contactIds.length === 0) return reply.send({ users: [] })

    const users = await prisma.user.findMany({
      where: {
        id:       { in: contactIds },
        username: { contains: q, mode: 'insensitive' }
      },
      select: { id: true, username: true, publicKey: true },
      take: 10
    })
    return reply.send({ users })
  })

  // Get a user's public key by ID
  fastify.get('/:userId/publickey', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where:  { id: request.params.userId },
      select: { id: true, username: true, publicKey: true }
    })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return reply.send({ user })
  })

  // Get conversations (only with contacts)
  fastify.get('/conversations', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const userId = request.user.userId

    // Get user's contact IDs
    const myContacts = await prisma.contact.findMany({
      where:  { ownerId: userId },
      select: { contactId: true }
    })
    const contactIds = new Set(myContacts.map(c => c.contactId))

    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      include: {
        sender:   { select: { id: true, username: true, publicKey: true } },
        receiver: { select: { id: true, username: true, publicKey: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    const seen = new Set()
    const conversations = []

    for (const msg of messages) {
      const other = msg.senderId === userId ? msg.receiver : msg.sender
      if (seen.has(other.id)) continue
      seen.add(other.id)
      // Only include if this person is in your contacts
      if (contactIds.has(other.id)) {
        conversations.push({
          user: other,
          lastMessage: {
            ciphertext: msg.ciphertext,
            createdAt:  msg.createdAt,
            senderId:   msg.senderId
          }
        })
      }
    }

    return reply.send({ conversations })
  })
}
