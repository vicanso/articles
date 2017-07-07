const session = require('koa-session');
const Koa = require('koa');
const app = new Koa();

const redisStore = require('./redis-store');


app.keys = ['some secret hurr'];

const CONFIG = {
  maxAge: 300 * 1000,
  store: redisStore,
};

app.use(session(CONFIG, app));
// or if you prefer all default config, just use => app.use(session(app));

app.use(ctx => {
  // ignore favicon
  if (ctx.path === '/favicon.ico') return;

  let n = ctx.session.views || 0;
  ctx.session.views = ++n;
  ctx.body = n + ' views';
});

app.listen(3000);
console.log('listening on port 3000');
