const assert = require('assert');
const dns = require('dns');
const request = require('superagent');

const DNS = require('./dns');

const dnsClient = new DNS('custom.domain', [
  {
    "ip": "192.168.31.3",
    "port": 5018,
  },
  {
    "ip": "192.168.31.4",
    "port": 5018,
  },
  {
    "ip": "192.168.31.5",
    "port": 5018,
  },
  {
    "ip": "192.168.31.6",
    "port": 5018,
    "backup": true,
  },
]);
dnsClient.enable();

dnsClient.startHealthCheck((server) => {
  return new Promise((resolve, reject) => {
    if (server.ip === '192.168.31.5') {
      reject(new Error('The server is sick'));
    } else {
      resolve();
    }
  });
}, 1000);


// health check 每秒检测一次，此时检测还没开始
assert.equal(dnsClient.get().ip, '192.168.31.3');
assert.equal(dnsClient.get().ip, '192.168.31.4');
assert.equal(dnsClient.get().ip, '192.168.31.5');
assert.equal(dnsClient.get().ip, '192.168.31.3');

// health check 已完成，192.168.31.5检测不过
// 因此下面的调用不会再有 192.168.31.5
setTimeout(() => {
  assert.equal(dnsClient.get().ip, '192.168.31.4');
  assert.equal(dnsClient.get().ip, '192.168.31.3');
  assert.equal(dnsClient.get().ip, '192.168.31.4');


  request.get('http://custom.domain:5018/')
    .then(res => console.dir(res.status))
    .catch(console.error);

}, 1200);