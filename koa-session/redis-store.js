const Redis = require('ioredis');

class SessionStore {
  constructor(redisClient) {
    this.redisClient = redisClient;
  }
  async get(key) {
    console.dir(key);
    const data = await this.redisClient.get(key);
    if (!data) {
      return null;
    }
    return JSON.parse(data);
  }
  async set(key, json, maxAge) {
    await this.redisClient.psetex(key, maxAge, JSON.stringify(json));
  }
  async destroy(key) {
    await this.redisClient.del(key);
  }
}

module.exports = new SessionStore(new Redis());
