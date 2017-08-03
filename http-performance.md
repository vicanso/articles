在这几年使用`node.js`做后端开发，主要还是开发基于`HTTP`的相关应用服务，无论是做`REST Server`还是去调用其它的服务，都是以`HTTP`为主。在做优化的时候首要的就是对`HTTP`做相关的优化，而一直以来，我们的原则都是无统计不优化，怎么做好`HTTP`的相关性能统计则成为了系统的重中之重。


## HTTP性能指标

HTTP的统计主要分两种，一种是作为客户端去调用其它服务获取数据，一种是作为服务端，接收到响应请求处理并响应。下面是两者需要关注的统计指标


- Request
  - 创建`Socket`
  - 域名解析(如果是IP的不需要)
  - `TCP`连接
  - `TLS`连接
  - 后端程序处理生成响应数据
  - 接收响应数据

-  Response
  - 创建`Socket`
  - 后端程序处理生成响应数据并返回

## 系统现状

在最开始的时候，对于接口的统计，我们都只是粗略的开始与结束的两个位置增加处理函数，生成时长，写入到`influxdb`中。现有流程中并没有做细化各处理的响应时间，而且在流程中增加代码来处理，每个模块需要各自增加自己的统计，标准不一。那么如果才能做更精准的统计，而且无入侵式的代码呢？

## 无入侵式的统计

首先先确认需要统计的指标值，对于统计的指标，我主要是参考了`chrome`的network面板与`httpstat`生成的统计时长，制定了以下的指标：

- 响应类型(request, response)
- dns解析的时间，解析获取的IP
- 正在处理的请求（request, response分开），便于直观反映当前系统的处理能力
- method
- url
- status code
- bytes
- timing 
    - socket 创建socket的时长
    - dns 域名解析的时长
    - tcp 创建TCP连接握手时长
    - tls 如果是HTTPS，需要做TLS握手，其时长
    - processing 程序接收请求，处理时长
    - transfer 数据传输时长
    - all 整个HTTP处理时长

最开始的想法是对`http`模块做改造，在研究`http`模块的时候，发现可以通过对`OutgoingMessage`做调整获取得到HTTP处理过程中的`socket`，而通过监控`socket`中的相关事件，下面是简约的代码介绍：

```js
// http-performance
function requestStats() {
  const timePoints = {};
  const result = {
    type: 'request',
  };
  statsData.requesting += 1;
  let done = false;
  const complete = () => {
    if (done) {
      return;
    }
    done = true;
    // 从timePoints中获取各流程的时长
  };
  timePoints.start = Date.now();
  this.once('socket', (socket) => {
    timePoints.socket = Date.now();
    // tcp(connect) tls(secureConnect)
    const events = 'connect data secureConnect'.split(' ');
    events.forEach((event) => {
      socket.once(event, () => {
        timePoints[event] = Date.now();
      });
    });
    socket.once('lookup', (err, ip, addressType, host) => {
      timePoints.lookup = Date.now();
      if (!err) {
        result.dns = {
          ip,
          addressType,
          host,
        };
      }
    });
    // if the socket will reuse(keepalive), the free event will be emit
    const endEvents = 'end free'.split(' ');
    endEvents.forEach(event => socket.once(event, complete));
  });
  this.once('close', complete);
}

function WrapOutgoingMessage() {
  OutgoingMessage.call(this);
  if (this.constructor.name === 'ServerResponse') {
    responseStats.apply(this);
    return;
  }
  requestStats.apply(this);
}
util.inherits(WrapOutgoingMessage, OutgoingMessage);


httpOutgoing.OutgoingMessage = WrapOutgoingMessage;

```

增加好统计监控之后，引入此模块，并将统计写入`influxdb`，

```js
const httpPerf = require('http-performance');
httpPerf.on('stats', (stats) => {
  influx.write('http-performance', stats);
});
```

之后对数据进行分析，做了下面的一些统计与调整：

- `http request`与`http response`的比例大概是3:1，系统大部分接口都依赖于外部的服务，这比例属于正常比例
- 系统在用户最活跃的时间内，各`node.js`实例的处理请求数在`2000`以下，设置监控阀值，如果大于`2000`则发送监控警报
- `DNS`的解析耗时不少，因此使用`dnscache`模块，减少`DNS`解析时长
- 每次请求都需要重新创建`socket`，而且系统的服务调用都是集中在某几个服务，因此使用`agentkeepalive`模块，增加连接的重用，提升性能
- 根据`40x`, `50x`的http status做监控警报
- 其中一个外部服务的`tls`时间特别长，分析优化认证过程

## 结语

对于系统的优化，监控，我们都基于统计数据，而如何高效又无入侵式代码的统计则是我们的优先选择，如果你的系统也苦恼于性能的优化与系统的监控，可以参考本文对系统做调整，在获取到统计数据之后就可有的放矢。

\* 在此我又要推荐一次`influxdb`，真的很好用