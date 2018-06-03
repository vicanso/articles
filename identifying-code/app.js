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
}
