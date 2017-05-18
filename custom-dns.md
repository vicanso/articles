# 负载均衡-自定义dns(node.js)

微服务架构大行其道，老板也似懂装懂的对我们普及其好处，过一段时间就问我们有没有做什么改造，做得如何。他不知道的是我们心里给他一百个白眼，没有人搭建基础架，才那几么个开发，业务任务重，谁愿意去做吃力不讨好的事啊。虽然我们的架构没有做到微服务，但是对于一些基础的功能模块，还是做为公共服务单独部署，方便后续各系统接入。公司现有系统呢，没有服务注册，没有服务发现，也不可以动态扩容，所以大家也都是纸上谈兵就算了。

## NGINX负载均衡阶段

按功能模块服务化是有做了一部分，都是部署之后通过`nginx`来做负载分发，每增加一个服务，都要配置一次`nginx`的配置，麻烦倒不说，而且为了避免单个`nginx`的负载太高，或者单点故障，后续要求每个基础服务都各自配置自己的`nginx`。那么单点故障呢？没办法避免了，只能`nginx`挂了就挂了，补救也只能加个监控程序就算了。

一直以来，这种方式大家也用得挺舒服的，突然有一天，有个`nginx`挂了，一直起不来，搞了半小时才恢复了，老板怒了，要求我们当天要拿出解决方案，
，我们小程序员只能再去想办法了。

- 使用微服务架构的方式，服务发现，服务注册各类功能的完善
- 负载均衡由程序来实现，直接去除`nginx`
- 每个基础服务启用两个`nginx`，在主`nginx`出问题时，程序将调用指向备`nginx`

微服务架构这个我们就不考虑了，技术上不行，基础没有，还有人员也不可能有。而多一个`nginx`做备的方案，本质上和现行的模式感觉也没有区别，出问题的时候还要配置上做调整，因此最终使用程序来实现负载均衡的方式

## 简单的服务发现

没有服务注册服务，那么就只能通过人手配置的方式，配置文件如下：

```json
[
  {
    "ip": "192.168.1.2",
    "port": 5000
  },
  {
    "ip": "192.168.1.3",
    "port": 5000
  },
  {
    "ip": "192.168.1.4",
    "port": 5000
  }
]
```

一开始的想法是改造`http request`的处理，自动选择从多个`backend`中选取其中一个，后来发现代码实在是写得太乱了，调用不一，改造难度比较复杂。最后研究了一下，为了避免对系统做太大的改造，选择使用自定义`dns`的方式，直接自己去实现`dns`的解析（因为端口不在dns中，因此一台机器最多只能部署一个同类的基础服务了）


## 自定义DNS

- 能根据域名自动解析返回对应的可用服务器IP地址
- 可以支持`backup`配置方式
- 可以支持服务可用检测
- 可以支持设置`weight`的方式


根据上面的需求，主要是对node.js中的`dns`模块做调整，将其`resolve`与`lookup`封装一次，实现自定义的解析，代码如下：

```js
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
```

具体代码与实现在[dns](./dns)目录中

## 结语

使用自定义的DNS解决方案只是因为它的实现简单，但是它的负载只能到IP级别，在实现使用中，我们的很多相同的服务在不同的机器上有可能使用不同的端口。最好当然是搭建一套好的微服务架构，但是对于小公司来说，就有点力不从心了，而在HTTP这一层做的负载，大家可以使用我写的模块[superagent-load-balancer](https://github.com/vicanso/superagent-load-balancer)。

以上情节纯属虚构，如有雷同，则是小公司必然情景
