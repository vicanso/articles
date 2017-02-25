const uuid = require('node-uuid');
const express = require('express');
const session = require('express-session');
const onHeaders = require('on-headers');
const RedisStore = require('connect-redis')(session);

// about 5KB
const basicInfo = require('./basic-info');

const app = express();

const getUserInfo = () => Object.assign({
  name: uuid.v4(),
}, basicInfo);

const sessionMiddleware = session({
  store: new RedisStore({
    ttl: 3600,
  }),
  resave: false,
  saveUninitialized: false,
  secret: 'keyboard cat',
});

const sessionReadonly = (req, res, next) => {
  // 在此我偷懒只对res.json做重载，
  // var _json = res.json;
  // res.json = (...args) => {
  //   delete req.sessionID;
  //   delete req.session;
  //   _json.call(res, ...args);
  // };
  sessionMiddleware(req, res, next);
  onHeaders(res, () => {
    delete req.sessionID;
    delete req.session;
  });
};

app.get('/user', sessionMiddleware, (req, res) => {
  if (!req.session.user) {
    console.info('Create new session');
    req.session.user = getUserInfo();
  }
  res.json(req.session.user);
});

app.get('/user/readonly', sessionMiddleware, (req, res) => {
  const user = req.session.user;
  res.json(user);
});

app.get('/foods', (req, res) => {
  res.json([]);
});

app.listen(7000);
console.info('Get user information from http://127.0.0.1:7000/user');
