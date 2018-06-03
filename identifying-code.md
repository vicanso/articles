# identifying code

在现有的产品线中，有各类不同的场景都需要对图形验证码、短信验证码、语音验证码等的校验。现系统中使用的常规处理方式：生成验证码记录至session中，客户提交的时候，从session中获取相应的验证码匹配。整体的流程如下：

- 生成验证码（图片或手机），写入至session中
- 生成图片（或发送短信）
- 等待接收客户端提交的验证请求，从session中读取，校验是否符合

在整个校验流程中，需要对session做写、读的操作，而本来session的设计是只有在客户登录之后，才会做session的保存，而产品中有部分流程的短信验证是不需要用户登录的，因此session的数据量级别有30%以上的增长。

既然不希望通过session来保存，那么我们就让客户端来保存，客户端调用生成验证码的时候，把验证码数据返回给客户端，客户提交的时候校验就好了。嗯，看着感觉就是这么简单？那么验证码数据怎么返回给客户端呢？加密，将验证码以加密后的形式返回给客户端。下面来看看代码：

```js
const appKey = 'MY-APP-KEY';
/**
 * 生成hash
 * @param {string} data
 * @param {string} key 
 */
function hash(data, key) {
  return crypto
    .createHmac('sha1', key)
    .update(data).digest('base64')
    .replace(/\/|\+|=/g, function(x) {
      return ({ "/": "_", "+": "-", "=": "" })[x]
    });
}
/**
 * 获取验证码 
 * @param {Number} len 长度，默认为6
 */
function getCode(len = 6) {
  const v = _.random(0, Math.pow(10, len));
  const code = _.padStart(`${v}`, len, '0');
  return {
    code: code,
    hash: hash(code, appKey),
  };
}

/**
 * 校验是否合法 
 * @param {string} code 
 * @param {string} hashValue 
 */
function verify(code, hashValue) {
  return hash(code, appKey) === hashValue;
}
```

在调用`getCode`获取数据`{"code":"424707","hash":"8lqFXYs0b1hsrlN6wqPaTVKwUz0"}`后，根据`code`生成图片（或发送短信）成功后，将`hash`值返回给客户端。客户提交校验验证码时，将客户输入的`code`与接口返回的`hash`的提交，后端程序`verify`校验。

客户无法知道使用的算法，就算被猜到了，那也无法知道`appKey`，所以破解的难度就很大了。看着感觉很安全了，是吧？忽然发现，那就错了。因为这种形式，每个`code`都会有唯一对应的`hash`，那么客户只要用点时间，慢慢去扫，6位数的验证码，总能把所有的`hash`都一一找出来，之后就可以根据`hash`得到真实的`code`了。

那么生成`hash`的形式就需要调整了，我们的目标是：

- 相同的`code`生成的`hash`可以变化（避免被列举所有的hash）
- `hash`有时效性，可以避免暴力破解

使用`keygrip`能支持多个key的hash校验，可以在设置的时间间隔内生成不同的key，并保证前面生成的key在固定期限内有效。那么如果保证多个实例之间，使用的是同样的key？最开始的想法是利用redis来保存这些key，有个定时任务去更新，但是这样反而更复杂了。因此最终使用的方案是根据当前系统时间，生成一个时间列表。

根据系统时间，每60秒一个间隔，往前往后取时间戳，生成key列表，如当前系统时间为`1526396880368`，对`60*1000`取整为`25439948`，生成9个时间戳：`['25439948', '25439949', '25439947', '25439950', '25439946', '25439951','25439945', '25439952', '25439944']`，这样的处理后，则保证了在当前系统时间前后时间段的的校验码都有效，并优先使用系统当前时间校验，调整后的代码如下：

```js
const _ = require('lodash');
const crypto = require('crypto');
const Keygrip = require('keygrip');

class CodeIdentifier {
  constructor(opts) {
    this.options = _.extend({
      interval: 60 * 1000,
      max: 5,
    }, opts);
    this.keys = [];
    this.freshKeys();
    this.keygrip = new Keygrip(this.keys);
  }
  /**
   * 刷新keys
   */
  freshKeys() {
    const {
      options,
      keys,
    } = this;
    const {
      interval,
      max,
    } = options;
    const now = Date.now();
    // 根据当前时间做为中间值（就算所有的机器时间有所偏差，key列表也可以保证校验符合）
    const start = Math.floor(now / interval);
    if (_.first(keys) === `${start}`) {
      return;
    }
    keys.length = 0;
    for (let i = 0; i < max; i++) {
      keys.push(`${start + i}`);
      if (i !== 0) {
        keys.push(`${start - i}`);
      }
    }
  }
  /**
   * 获取验证码
   * @param {number} len 验证码长度
   */
  getCode(len = 6) {
    const {
      keygrip,
    } = this;
    const v = _.random(0, Math.pow(10, len));
    const code = _.padStart(`${v}`, len, '0');
    this.freshKeys();
    const hash = keygrip.sign(code);
    return {
      hash,
      code,
    };
  }
  /**
   * 校验验证码是否合法
   * @param {string} code 
   * @param {string} hash 
   */
  verify(code, hash) {
    const {
      keygrip,
    } = this;
    this.freshKeys(); 
    return keygrip.verify(code, hash);
  }
}
```

至此，验证码保证了每个时间间隔内相同的`code`生成的`hash`不一致，而且在获取验证码的接口也有频率限制。想要历遍获取所有的`hash`已是不太可能，安全性上已大大提高。
如果希望生成`hash`的时候，增加与客户端相关的一些信息，让校验过程更安全一些，例如使用客户的唯一track cookie或者客户IP等参数，优化`getCode`与`verify`函数：

```js
  /**
   * 获取验证码
   * @param {number} len 验证码长度
   * @param {string} id 
   */
  getCode(len = 6, id = '') {
    const {
      keygrip,
    } = this;
    const v = _.random(0, Math.pow(10, len));
    const code = _.padStart(`${v}`, len, '0');
    this.freshKeys();
    const hash = keygrip.sign(`${code}${id}`);
    return {
      hash,
      code,
    };
  }
  /**
   * 校验验证码是否合法
   * @param {string} code 
   * @param {string} hash 
   * @param {string} id
   */
  verify(code, hash, id = '') {
    const {
      keygrip,
    } = this;
    this.freshKeys(); 
    return keygrip.verify(`${code}${id}`, hash);
  }
```

`getCode`与`verify`都支持客户端标识的`id`参数，因此保证了不同客户端在同一时间间隔内，同一个`code`生成的`hash`也不一致，通过这翻调整，在安全与性能上都已达到预期，简化了验证码的校验逻辑。