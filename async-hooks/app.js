const Koa = require('koa');
const _ = require('lodash');
const mongoose = require('mongoose');
const bluebird = require('bluebird');
const als = require('async-local-storage');
const shortid = require('shortid');
const util = require('util');
const request = require('superagent');
const Timing = require('supertiming');

mongoose.Promise = bluebird;

mongoose.connect('mongodb://127.0.0.1/test');

const User = mongoose.model('User', {
   name: String,
   email: String,
   createdAt: {
     type: String,
     default: () => new Date().toISOString(),
   },
});

const UserVisit = mongoose.model('UserVisit', {
  name: String,
  createdAt: {
    type: String,
    default: () => new Date().toISOString(),
  },
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));


// 创建数据存储
async function initUsers() {
  await User.findOneAndUpdate({
    name: 'tree.xie',
  }, {
    name: 'tree.xie',
    email: 'vicansocanbico@gmail.com',
  }, {
    upsert: true,
  });
  await User.findOneAndUpdate({
    name: 'vicanso',
  }, {
    name: 'vicanso',
    email: 'vicansocanbico@gmail.com',
  }, {
    upsert: true,
  });
}

async function getUser(name) {
  const doc = await User.findOne({
    name,
  });
  return _.pick(doc, ['name', 'email']);
}

function log(...args) {
  const id = als.get('id') || 'unkonwn';
  const user = als.get('user') || 'anonymous';
  args.unshift(user, id);
  console.info(util.format(...args));
}

initUsers()
  .then(() => console.info('init users success'))
  .catch(err => console.error(`init user fail, ${err.message}`));

const app = new Koa();
als.enable();

// 接收请求，获取ID并设置X-Response-Id
app.use((ctx, next) => {
  const id = ctx.get('X-Request-Id') || shortid();
  ctx.set('X-Response-Id', id);
  als.set('id', id);
  als.set('timing', new Timing({
    precision: 'ms',
  }));
  return next();
});

// 获取用户信息
app.use(async (ctx, next) => {
  const account = ctx.query.account;
  const start = Date.now();
  const end = als.get('timing').start('getUserInfo');
  if (account) {
    ctx.state.user = await getUser(account);
  } else {
    ctx.state.user = {
      name: 'anonymous',
      email: 'unknown',
    };
  }
  als.set('user', ctx.state.user.name);
  const use = Date.now() - start;
  log(`get info use ${use}ms`);
  end();
  return next();
});

// 延时执行
app.use(async (ctx, next) => {
  const start = Date.now();
  const end = als.get('timing').start('delay');
  await delay(_.random(3000));
  const use = Date.now() - start;
  log(`delay ${use}ms`);
  end();
  return next();
});

// 根据IP获取客户定位
app.use(async (ctx, next) => {
  const start = Date.now();
  const end = als.get('timing').start('getLocationByIP');
  const url = 'http://ip.taobao.com/service/getIpInfo.php';
  const res = await request.get(url)
    .set('Accept', 'application/json')
    .query({
      ip: '8.8.8.8',
    });
  const use = Date.now() - start;
  log('get location by ip ', res.text, ` use ${use}ms`);
  end();
  return next();
});

// 记录用户访问
app.use(async (ctx, next) => {
  const name = ctx.state.user.name;
  const start = Date.now();
  const end = als.get('timing').start('addUserVisit');
  await new UserVisit({
    name,
  }).save();
  const use = Date.now() - start;
  log(`add visit use ${use}ms`);
  end();
  return next();
});

// 响应请求
app.use((ctx) => {
  const user = ctx.state.user;
  const timing = als.get('timing');
  log(timing.toString());
  ctx.set('Server-Timing', timing.toServerTiming());
  ctx.body = `Hello world, ${user.name}:${user.email}`;
});

const server = app.listen(process.env.PORT);

console.info(`Server is listen on: http://127.0.0.1:${server.address().port}`);