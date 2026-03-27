const { prisma } = require('../middleware/authenticate')

// Store connected users: userId -> websocket connection
const connectedUsers = new Map()

module.exports = async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket, request) => {

    let currentUserId = null

    socket.on('message', async (rawMessage) => {
      try {
        const data = JSON.parse(rawMessage.toString())

        // Step 1: User identifies themselves with their token
        if (data.type === 'auth') {
          try {
            const decoded = fastify.jwt.verify(data.token)
            currentUserId = decoded.userId
            connectedUsers.set(currentUserId, socket)
            console.log(`✅ User connected: ${currentUserId}`)
            socket.send(JSON.stringify({ type: 'auth_success' }))
          } catch {
            socket.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }))
          }
          return
        }

        // All other actions require authentication
        if (!currentUserId) {
          socket.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }))
          return
        }

        // Step 2: Relay typing indicator to receiver
        if (data.type === 'typing') {
          const receiverSocket = connectedUsers.get(data.receiverId)
          if (receiverSocket && receiverSocket.readyState === 1) {
            receiverSocket.send(JSON.stringify({
              type: 'typing',
              senderId: currentUserId,
              isTyping: data.isTyping
            }))
          }
          return
        }

        // Step 3: Deliver encrypted message in real-time
        if (data.type === 'message') {
          const { receiverId, ciphertext, senderPublicKey, mediaType, mediaName } = data

          // Reject files over 10MB (base64 encoded)
          if (ciphertext.length > 14 * 1024 * 1024) {
            socket.send(JSON.stringify({ type: 'error', message: 'File too large. Max 10MB.' }))
            return
          }

          const message = await prisma.message.create({
            data: {
              senderId: currentUserId, receiverId, ciphertext,
              senderPublicKey: senderPublicKey || '',
              mediaType: mediaType || null,
              mediaName: mediaName || null
            },
            include: { sender: { select: { id: true, username: true, publicKey: true } } }
          })

          const payload = {
            id:              message.id,
            ciphertext:      message.ciphertext,
            senderId:        message.senderId,
            receiverId:      message.receiverId,
            senderPublicKey: message.senderPublicKey,
            mediaType:       message.mediaType,
            mediaName:       message.mediaName,
            createdAt:       message.createdAt,
            sender:          { id: message.sender.id, username: message.sender.username },
          }

          const receiverSocket = connectedUsers.get(receiverId)
          if (receiverSocket && receiverSocket.readyState === 1) {
            receiverSocket.send(JSON.stringify({ type: 'new_message', message: payload }))
          }

          socket.send(JSON.stringify({ type: 'message_sent', message: payload }))
        }

      } catch (err) {
        console.error('WebSocket error:', err)
        socket.send(JSON.stringify({ type: 'error', message: 'Something went wrong' }))
      }
    })

    // Cleanup when user disconnects
    socket.on('close', () => {
      if (currentUserId) {
        connectedUsers.delete(currentUserId)
        console.log(`❌ User disconnected: ${currentUserId}`)
      }
    })
  })
}