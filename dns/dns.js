const dns = require('dns');

const domainSym = Symbol('domain');
const serversSym = Symbol('servers');
const indexSym = Symbol('index');

class DNS {
  /**
   * 设置自定义的doman以及server列表
   */
  constructor(domain, servers) {
    this[domainSym] = domain;
    this[serversSym] = servers.map(server => Object.assign({
      disabled: false,
      weight: 1,
    }, server));
    this[indexSym] = 0;
  }
  /**
   * 根据当前index获取所对应的服务器信息
   */
  get() {
    const servers = this[serversSym];
    let index = this[indexSym];
    let weightCount = 0;
    const enabledServers = [];
    // 根据可用的，且非backup的服务器配置中，
    // 计算总的weight以及记录可用服务器信息
    servers.forEach((server) => {
      if (!server.disabled && !server.backup) {
        weightCount += server.weight;
        enabledServers.push(server);
      }
    });
    // 如果无可用服务器信息，则从backup中选择
    if (!enabledServers.length) {
      servers.forEach((server) => {
        if (!server.disabled) {
          weightCount += server.weight;
          enabledServers.push(server);
        }
      });
    }
    // 如果backup中选择的都无可用列表，throw error
    if (!enabledServers.length) {
      throw new Error('There is not server is usable');
    }
    index %= weightCount;
    let found;
    let currentWeight = 0;
    // 根据server weight 与当前 weight 选择可用的服务器
    enabledServers.forEach((server) => {
      currentWeight += server.weight;
      if (!found && currentWeight > index) {
        found = server;
      }
    });
    this[indexSym] = index + 1;
    return found;
  }
  /**
   * 启用健康检测，如果健康检测不过的，设置disabled
   */
  startHealthCheck(fn, interval) {
    const servers = this[serversSym];
    return setInterval(() => {
      servers.forEach((server) => {
        const promise = fn(Object.assign({}, server));
        promise.then(() => {
          server.disabled = false;
        }, () => {
          server.disabled = true;
        });
      });
    }, interval);
  }
  /**
   * 是否启用dns，启用之后，会调整默认的dns.resolve函数，
   * 在配置的domain中直接根据配置返回对应的IP。
   * 注意：只返回1个IP地址，会根据权重等自动获取相应的IP地址，因此不要对DNS解析做缓存
   */
  enable() {
    const originalResolve = dns.resolve;
    const originalLookup = dns.lookup;
    const domain = this[domainSym];
    // 还有其它dns解析函数未全部做处理
    dns.lookup = (...args) => {
      if (args[0] !== domain) {
        originalLookup(...args);
      } else {
        const cb = args[args.length - 1];
        try {
          const server = this.get();
          cb(null, server.ip, 4);
        } catch (err) {
          cb(err);
        }
      }
    };
    dns.resolve = (...args) => {
      if (args[0] !== domain) {
        originalResolve(...args);
      } else {
        const cb = args[args.length - 1];
        try {
          const server = this.get();
          cb(null, [server.ip]);
        } catch (err) {
          cb(err);
        }
      }
    }
  };
}

module.exports = DNS;
