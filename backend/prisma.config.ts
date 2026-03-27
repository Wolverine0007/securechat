import path from 'path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: 'postgresql://sanketbanate@localhost:5432/securechat',
  },
})