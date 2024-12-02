import { Client } from 'redis-om'
import { mgxAirdropSchema } from '../model/MgxAirdrop.js'
import { getTimeseriesUrl } from '../connector/RedisConnector.js'
import logger from '../util/Logger.js'

const client = new Client()
await client.open(getTimeseriesUrl())

export const mgxAirdropRepository = client.fetchRepository(mgxAirdropSchema)

try {
  await mgxAirdropRepository.createIndex()
} catch (error) {
  if (!error.message.includes('mgxAirdrop index already exists')) {
    throw error
  }
  logger.log({
    level: 'info',
    message: 'MGX Airdrop index already exists, skipping creation.',
  })
}