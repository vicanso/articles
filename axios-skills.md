# axios妙用技巧

## 前言

应用开发中，各服务的调用使用最多的就是HTTP的形式，使用的HTTP client也从request --> superagent --> axios。`axios`中的各类函数都是基于`promise`的形式，虽然我也钟情于`superagent`的链式调用，但`axios`的各类`promise`：`transform`，`interceptor`等特性，只能拥抱无法拒绝~

## create

创建一个新的实例，此实例的公共配置独立与其它实例。一般在后端开发会经常需要对接各类不同的服务，而各服务使用单独的实例是较合理的方法，如下面例子初始化一个用于调用百度服务的实例：

```js
const axios = require('axios');

const baiduService = axios.create({
  // 设置接口路径（相对路径将拼接此路径）
  baseURL: 'https://www.baidu.com/',
  // 根据不同的应用设置默认的超时
  timeout: 3 * 1000,
});

async function main() {
  try {
    const res = await baiduService.get('/');
    console.info(res.status);
  } catch (err) {
    console.error(err);
  }
}
main();
```

## transformRequest

在发送请求前，可以对发送的数据做转换处理，默认的`transformRequest`中会将提交的数据转换为对应的字符串（json或者querystring），具体代码可查看[transformRequest](https://github.com/axios/axios/blob/master/lib/defaults.js#L32)。

我的应用中有一个统计服务，使用的是批量发送统计指标（设置为每次发送200个指标），对带宽的占用较大，因此希望发送指标时做数据压缩，下面看看怎么针对需求实现自定义的`transform`。

```js
const axios = require('axios');
const zlib = require('zlib');

const localService = axios.create({
  baseURL: 'http://127.0.0.1:3000/',
  timeout: 3 * 1000,
  transformRequest: [
    // 复用原有的转换，实现json --> json string
    axios.defaults.transformRequest[0],
    (data, header) => {
      // 如果数据少于1KB，不压缩
      if (data.length < 1024) {
        return data;
      }
      // 将数据压缩（可根据需要，只压缩长度大于多少的数据）
      // 设置数据类型
      header['Content-Encoding'] = 'gzip';
      const w  = zlib.createGzip();
      w.end(Buffer.from(data));
      return w;
    },
  ],
});

async function main() {
  try {
    const arr = [];
    for (let index = 0; index < 100; index++) {
      // 模拟生成统计数据
      arr.push({
        category: 'login',
        account: 'vicanso',
        value: Math.round(Math.random() * 100),
        ip: '127.0.0.1',
      });
    }
    const res = await localService.post('/', {
      data: arr,
    });
    console.info(res.status);
  } catch (err) {
    console.error(err);
  }
}
main();
```


服务端代码：

```js
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const router = new Router();


// body parser中可以解压数据
// 如果希望支持再多类型的压缩数据，可参考https://github.com/stream-utils/inflation调整
app.use(bodyParser());

router.post('/', async (ctx) => {
  console.dir(ctx.request.body);
  ctx.body = 'OK';
});

app
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(3000);
```

通过上面的自定义gzip的transform，带宽的占用节约了70%左右，当然这里会增加了CPU的损耗，根据各自的应用场景选择不压缩或者使用snappy等压缩速度优先的算法。

## transformResponse

在接收到响应数据时，可以对响应数据做转换处理，默认的`transform`是调用`JSON.parse`转换为对应的Object。其的使用方法与`transformRequest`类似，不再举例细说。

## adapter

可实现自定义的请求处理，`axios`实现了基于浏览器的`xhr`以及`nodejs`的两种处理，使其适应于两种运行环境。一般我们不需要自己去实现adapter，主要的使用场景是在测试中mock数据，如下：

```js
const axios = require('axios');

const baiduService = axios.create({
  // 设置接口路径（相对路径将拼接此路径）
  baseURL: 'https://www.baidu.com/',
  // 根据不同的应用设置默认的超时
  timeout: 3 * 1000,
});


function mockAdapter(ins, fn) {
  const {
    adapter,
  } = ins.defaults;
  ins.defaults.adapter = fn;
  return () => {
    ins.defaults.adapter = adapter;
  };
}

async function main() {
  const done = mockAdapter(baiduService, (config) => {
    // mock response，只返回状态码与data
    return Promise.resolve({
      status: 200,
      data: 'OK',
    });
  });
  try {
    const res = await baiduService.get('/');
    // 恢复adapter
    console.info(res.status);
  } catch (err) {
    console.error(err);
  } finally {
    done();
  }
}
main();
```

## http(s)Agent

指定在nodejs环境中的http(s)的agent，如可以启用keepAlive，复用TCP连接，提升性能（默认是未启用）。

```js
const axios = require('axios');
const http = require('http');
const https = require('https')

const localService = axios.create({
  baseURL: 'http://127.0.0.1:3000/',
  timeout: 3 * 1000,
  httpAgent: new http.Agent({
    keepAlive: true,
  }),
  httpsAgent: new https.Agent({
    keepAlive: true
  }),
});

async function main() {
  try {
    // 两次顺序调用，复用同样的tcp连接
    let res = await localService.get('/');
    console.info(res.status);
    res = await localService.get('/');
    console.info(res.status);
  } catch (err) {
    console.error(err);
  }
}
main();
```


服务端的代码，展示是否使用同一TCP连接：


```js
const Koa = require('koa');
const Router = require('koa-router');

const app = new Koa();
const router = new Router();


router.get('/', async (ctx) => {
  // 生成socke id，用于标记TCP连接
  if (!ctx.socket._id) {
    ctx.socket._id = Math.floor(Math.random() * 1000);
  }
  console.info(ctx.socket._id);
  ctx.body = 'OK';
});

app
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(3000);
```

## Interceptors

`Interceptors`是`axios`的一大特色，使用拦截器可以对发送请求、接收数据做各类的操作（异步的也支持）。如请求重试，前置认证等等。

### request interceptor

后端服务部署，为了高可用，避免单点故障，一般而言都会部署多节点。各服务之间的调用，简单的方式则是使用nginx或haproxy之类做反向代理，应用程序只接入反向代理的节点，这样简单方便，实际上反向代理则成为单点，达不到高可用的目标（实际情况对于大部分公司，访问量不大，反向代理稳定，基本也不出状况）。下面我们来讨论如果在客户端实现高可用的接入方式（如有完善的微服务体系，接入sidecar更简单便捷，无代码入侵性）：


```js
const axios = require('axios');

class Backends {
  constructor(backends) {
    this.backends = backends.map((url) => {
      return {
        url,
        healthy: false,
      };
    });
  }
  // 选择其中可用的backend
  get(policy) {
    let backend = null;
    switch (policy) {
      case 'first':
        this.backends.forEach((item) => {
          if (!backend && item.healthy) {
            backend = item;
          }
        });
        break;
      // 可实现更多的选择策略，如round robin等
      default:
        break;
    } 
    return backend;
  }
  doHealthCheck() {
    // 可以调用为5次测试，3次通过则认为healthy
    this.backends.forEach((backend) => {
      axios.get(`${backend.url}/ping`).then((res) => {
        const {
          status,
        } = res;
        if (status === 200) {
          backend.healthy = true;
        } else {
          backend.healthy = false;
        }
      }).catch(() => {
        backend.healthy = false;
      })
    });
  }
  startHealthCheck() {
    setInterval(() => {
      this.doHealthCheck();
    }, 5000).unref();
    this.doHealthCheck();
  }
}

const localServiceBackends = new Backends([
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
]);
localServiceBackends.startHealthCheck();

const localService = axios.create({
  timeout: 3 * 1000,
});

localService.interceptors.request.use((config) => {
  const backend = localServiceBackends.get('first');
  if (!backend) {
    return Promise.reject(new Error('无可用的服务'))
  }
  config.baseURL = backend.url;
  return config;
})

async function main() {
  try {
    const res = await localService.get('/');
    console.info(res.status);
  } catch (err) {
    console.error(err);
  }
}

// 延时执行，等待首次health check
setTimeout(main, 1000);
```

服务端代码：

```js
const Koa = require('koa');
const Router = require('koa-router');

const app = new Koa();
const router = new Router();


router.get('/', async (ctx) => {
  ctx.body = 'OK';
});

router.get('/ping', (ctx) => {
  ctx.body = 'pong';
});

app
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(3000);
```

### response interceptor

函数调用出错统一基于`Error`对象扩展，后端各服务都限定了标准的出错返回，以JSON的形式返回出错数据{"message": "出错信息", ...}，其中`message`则是出错信息，因此需要调整`axios`以兼容接口的出错响应（默认返回的Error.message为http状态码的描述）。


```js
const axios = require('axios');

const localService = axios.create({
  baseURL: 'http://127.0.0.1:3000/',
  timeout: 3 * 1000,
});

localService.interceptors.response.use(null, (err) => {
  if (err.response && err.response.data) {
    const {
      data,
    } = err.response;
    if (data.message) {
      // 可以根据后端出错数据的标准，往error中添加再多的属性
      err.message = data.message;
    }
  }
  return Promise.reject(err);
});

async function main() {
  try {
    await localService.get('/');
  } catch (err) {
    console.error(err.message);
  }
}
main();
```

服务端代码：

```js
const Koa = require('koa');
const Router = require('koa-router');

const app = new Koa();
const router = new Router();

// 公共的出错处理
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.status = err.status || 500;
    ctx.body = {
      message: err.message,
    };
  }
});

router.get('/', async (ctx) => {
  ctx.throw(400, '出错了')
});

router.get('/ping', (ctx) => {
  ctx.body = 'pong';
});

app
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(3000);
```

### 接口分析

组合使用`request`与`response`的`interceptors`，可以无入侵式的增加接口分析，如性能、接口响应、数据等统计分析。

```js
const axios = require('axios');

const localService = axios.create({
  baseURL: 'http://127.0.0.1:3000/',
  timeout: 3 * 1000,
});


const stats = (response) => {
  // 未考虑各类异常场景
  const {
    config,
  } = response;
  const {
    method,
    url,
    _start,
  } = config;
  // 可输出更多的参数，如post数据，响应数据等
  console.info(`${method} ${url} ${Date.now() - _start}ms status:${response.status}`);
};

localService.interceptors.request.use((config) => {
  config._start = Date.now();
  return config;
});

localService.interceptors.response.use((response) => {
  stats(response);
}, (err) => {
  stats(err.response);
  return Promise.reject(err);
});

async function main() {
  try {
    await localService.post('/');
    await localService.post('/error');
  } catch (err) {
    console.error(err.message);
  }
}
main();
```

服务端代码：

```js
const Koa = require('koa');
const Router = require('koa-router');

const app = new Koa();
const router = new Router();

// 公共的出错处理
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.status = err.status || 500;
    ctx.body = {
      message: err.message,
    };
  }
});

router.post('/', async (ctx) => {
  ctx.body = {
    foo: 'bar',
  };
});
router.post('/error', async (ctx) => {
  ctx.throw(400, '出错啦');
});

router.get('/ping', (ctx) => {
  ctx.body = 'pong';
});

app
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(3000);
```
