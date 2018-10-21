# koa使用小技巧

## cookie的安全保护

基于cookie来验证用户状态的系统中，如何提高cookie的安全级别是首要因素，最简单直接的方式就生成的cookie值随机而且复杂。一般使用uuid来生成cookie，生成的随机串在复杂度上已满足需求，但是如果真被攻击者尝试到一个可用的值，那怎么防范呢？使用signed的cookie设置，如下所示：

```js
app.keys = ["token"];

...

ctx.cookies.set("jt", "abcd", {
  signed: true,
});
```

在设置`jt`这个cookie的时候，koa会以`jt`的值`abcd`加上设置的密钥，生成校验值，并写入至`jt.sig`这个cookie中，所以能看到响应的HTTP头中如下所示：

```
Set-Cookie: jt=abcd; path=/; httponly
Set-Cookie: jt.sig=gpDbdxr25sarDhE_1yMSAnIn_bU; path=/; httponly
```

在后续的请求中，获取`jt`这个cookie时，则会根据`jt.sig`的值判断是否合法，安全性上又明显提升。

那么`app.keys`为什么是设计为数组呢？先来考虑以下的一种场景，当希望更换密钥的时候，原有的的cookie都将因为密钥更新而导致校验失败，则用户的登录状态失效。一次还好，如果需要经常需要更新密钥（我一般一个月更换一次），那怎么处理好？这就是`app.keys`为配置为数组的使用逻辑了。

当生成cookie时，使用keys中的第一个元素来生成，而校验的时候，是从第一个至最后一个，一个个的校验，直到通过为止，所以在更新密钥的时候，只需要把新的密钥加到数组第一位则可以。我一般再保留两组密钥，因为更新是一个月一次，因此如果客户的cookie是三个月前生成的，那就会失效了。

cookie的校验是基于[keygrip](https://github.com/crypto-utils/keygrip)来处理的，大家也可以使用它来做自己的一些数据校验，如验证码之类。

## 异常处理

在使用koa时，一般出错都是使用`ctx.throw`来抛出一个error，中断处理流程，接口响应出错，处理逻辑如下所未：

```js
app.on('error', (err, ctx) => {
  // 记录异常日志
  console.error(err);
});

app.use((ctx) => {
  ctx.throw(400, '参数错误');
});
```

此处只利用了koa自带的异常出错，过于简单，我们希望能针对主动抛出的异常与程序异常能加以区分，因此需要自定义异常处理的中间件，如下：

```js
app.on('error', (err, ctx) => {
  // 记录异常日志
  console.error(err);
});

app.use(async(ctx, next) => {
  try {
    await next()
  } catch (err) {
    let status = 500;
    const message = err.message;
    // koa的throw使用http-errors来生成error
    // 此处只判断是否有status，有则认为是http-errors
    if (err.status) {
      status = err.status
    } else {
      // 非主动抛出异常，则触发error事件，记录异常日志
      ctx.app.emit("error", err, ctx);
    }
    ctx.status = status;
    ctx.body = {
      message,
    };
  }
})

app.use((ctx) => {
  // 代码异常
  // ctx.i.j = 0;
  // 主动抛出异常
  ctx.throw(400, '参数错误');
});
```

通过此调整后，将逻辑主动抛出异常与程序异常区分开，定时去查看异常日志，减少程序异常。此例子只是简单的使用了http-errors来创建主动抛出的异常，在实际使用中，可以根据自己的场景创建自定义的Error类，定制相应的异常信息。

## 当前正在处理请求数

得益于nodejs的IO处理，koa在高并发的场景下的CPU、内存都占用并不高，但是也因为这样，如果只通过CPU、内存来监控程序运行状态并不全面，因此需要增加当前处理请求数的监控，代码如下：

```js
let processingCount = 0;
const maxProcessingCount = 1000;
app.use(async (ctx, next) => {
  processingCount++;
  if (processingCount > maxProcessingCount) {
    // 如果需要也可以直接在处理请求超时时，直接出错
    console.error("processing request over limit");
  }
  try {
    await next();
  } catch (err) {
    throw err; 
  } finally {
    processingCount--;
  }
});

app.use(async (ctx) => {
  // 延时一秒
  await new Promise(resolve => setTimeout(resolve, 1000));
  ctx.body = {
    account: 'vicanso',
  };
});
```

此中间件在接收到请求时，将处理请求数加一，在处理完成后减一。最大的处理请求数根据系统的性能与用户数量选择合理的值。如果接口处理慢或者突然并发请求暴涨的时，可以尽早得知异常情况，尽早排查。

## 延时响应

接口的处理一般而言都是希望越快越好，但有些场景我们不希望接口响应的太快（如注册），避免恶意者迅速尝试功能，因此需要一个延时响应的中间件，代码如下：

```js
function delayResponse(delayMs) {
  const delay = (t) => {
    const d = delayMs - (Date.now() - t);
    // 如果处理时长已超过delayMs，无需等待
    if (d <= 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => setTimeout(resolve, d));
  }
  return async(ctx, next) => {
    const startedAt = Date.now();
    try {
      await next();
      // 成功处理时等待
      await delay(startedAt);
    } catch (err) {
      // 失败时也等待
      await delay(startedAt);
      throw err;
    }
  }
}

router.post('/users/v1/register', delayResponse(1000), (ctx) => {
  ctx.body = {
    account: 'vicanso',
  };
});
```

通过此中间件，可以限制某些功能的响应时长（保证每次处理时间都大于期望值），需要注意的是，延时响应的不要超过全局的超时配置。

## 接口性能统计

系统是否稳定，性能是否需要优化等都依赖于统计，为了能及时反应出系统状态，并方便添加告警指标，我将相关的统计数据写入influxdb，主要指标如下：

tags:

- method，请求类型
- type，根据响应状态码分组，1xx -> 1, 2xx -> 2
- spdy，根据自定义的响应时间划分区间，方便将接口响应时间分组
- route，接口路由

fields:

- connecting，处理请求数
- use，处理时长
- bytes，响应数字长度
- code，响应状态码
- url，请求地址
- ip，用户IP

在influxdb中，tags可用于对数据分组，根据`type`将接口请求分组，将`4`与`5`的单独监控，可以简单快速的把当前接口出错汇总。统计中间件代码如下：

```js
function stats() {
  let connecting = 0;
  const spdyList = [
    100,
    300,
    1000,
    3000,
  ];
  return async (ctx, next) => {
    const start = Date.now();
    const tags = {
      method: ctx.method,
    };
    connecting++;
    const fields = {
      connecting,
      url: ctx.url,
    }
    let status = 0;
    try {
      await next();
    } catch (err) {
      // 出错时状态码从error中获取
      status = err.status;
      throw err;
    } finally {
      // 如果非出错，则从ctx中取状态码
      if (!status) {
        status = ctx.status;
      }
      const use = Date.now() - start;
      connecting--;
      tags.route = ctx._matchedRoute;
      tags.type = `${status / 100 | 0}`
      let spdy = 0;
      // 确认处理时长所在区间
      spdyList.forEach((v, i) => {
        if (use > v) {
          spdy = i + 1;
        }
      });
      tags.spdy = `${spdy}`;

      fields.use = use;
      fields.bytes = ctx.length || 0;
      fields.code = status;
      fields.ip = ctx.ip;
      // 统计数据写入统计系统（如influxdb）
      console.info(tags);
      console.info(fields);
    }
  };
}

app.use(stats());

router.post('/users/v1/:type', async (ctx) => {
  await new Promise(resolve => setTimeout(resolve, 100))
  ctx.body = {
    account: 'vicanso',
  };
});
```

## 接口全日志记录

为了方便排查问题，需要将接口的相关信息输出至日志中，中间件的实现如下：

```js
function tracker() {
  const stringify = (data) => JSON.stringify(data, (key, value) => {
    // 对于隐私数据做***处理
    if (/password/.test(key)) {
      return '***';
    }
    return value;
  });
  return async (ctx, next) => {
    const trackerInfo = {
      url: ctx.url,
      form: ctx.request.body,
    };
    try {
      await next();
    } catch (err) {
      trackerInfo.error = err.message;
      throw err;
    } finally {
      trackerInfo.params = ctx.params;
      if (!trackerInfo.error) {
        trackerInfo.body = ctx.body;
      }
      console.info(stringify(trackerInfo))
    }
  };
}

app.use(bodyParser());
app.use(tracker());

router.post('/users/v1/:type', async (ctx) => {
  // ctx.throw(400, '密码出错');
  await new Promise(resolve => setTimeout(resolve, 100))
  ctx.body = {
    account: 'vicanso',
  };
});
```

使用此中间件之后，可以将所有接口的参数、正常响应数据或出错信息都全部输出至日志中，可根据需要调整`stringify`的实现，将一些隐私数据做***处理。需要注意的是，由于部分接口的body响应体部分较大，是否需要将所有数据都输出至日志最好根据实际情况衡量。如可根据HTTP Method过滤，或者根据url规则等。

## 参数校验

由于javascript的弱类型，接口参数校验一直是要求最严格的一点，而在了解过`joi`之后，我就一直使用它来做参数校验，如注册功能，账号、密码为必选参数，而邮箱为可选，接口校验的代码如下：

```js
function validate(data, schema) {
  const result = Joi.validate(data, schema);
  if (result.error) {
    // 出错可创建自定义的校验出错类型
    throw result.error;
  }
  return result.value;
}

router.post('/users/v1/register', async (ctx) => {
  const data = validate(ctx.request.body, Joi.object({
    // 账号限制长度为3-20个字符串
    account: Joi.string().min(3).max(20).required(),
    // 密码限制长度为6-30，而且只允许字母与数字
    password: Joi.string().regex(/^[a-zA-Z0-9]{6,30}$/).required(),
    email: Joi.string().email().optional(),
  }));
  ctx.body = {
    account: data.account,
  };
});
```
通过joi简单快捷实现了参数的校验，不过在实际使用中，有部分的参数校验规则是通用的，如账号、密码这些的校验规则在注册和登录中都通过，但是有些接口是可选，有一些是必须，怎么才能更通用一些呢？代码调整如下：

```js
const userSchema = {
  // 账号限制长度为3-20个字符串
  account: () => Joi.string().min(3).max(20),
  // 密码限制长度为6-30，而且只允许字母与数字
  password: () => Joi.string().regex(/^[a-zA-Z0-9]{6,30}$/),
  email: () => Joi.string().email(),
}

router.post('/users/v1/register', async (ctx) => {
  const data = validate(ctx.request.body, Joi.object({
    account: userSchema.account().required(),
    password: userSchema.password().required(),
    email: userSchema.email().optional(),
  }));
  ctx.body = {
    account: data.account,
  };
});
```

经此调整后，将用户参数校验的基本规则都定义在`userSchema`中，每个接口在各自的场景下选择不同的参数以及增加规则，提高代码复用率以及校验准确性。
