const shortid = require('shortid');
const _ = require('lodash');
const Influx = require('influxdb-nodejs');
const cluster = require('cluster');
const processNames = [
  'cherry',
  'grape',
  'watermenlon',
  'coconut',
  'lichee',
  'pear',
  'pomelo',
  'avocado',
];

const client = new Influx('http://localhost:8086/mydb');
let maxQueueSize = 300;

client.schema('http', {
  code: 'integer',
  use: 'integer',
  bytes: 'integer',
  token: 'string',
  url: 'string',
});

function generateRoutes(max) {
  const arr = [];
  for (let i = 0; i < max; i++) {
    arr.push(`/route-name/:${shortid.generate()}`);
  }
  return arr;
}
const routes = require('./routes');


function writePoint() {
  const method = _.sample('GET POST PUT DELETE OPTIONS'.split(' '));
  const spdy = _.sample('slower slow normal fast faster'.split(' '));
  const type = _.sample('1 2 3 4 5'.split(' '));
  const tags = {
    method,
    spdy,
    type,
    route: _.sample(routes),
    process: process.env.NAME || 'unknown',
  };
  const fields = {
    code: _.random(100, 599),
    use: _.random(100, 10000),
    bytes: _.random(0, 50 * 1024),
    token: shortid.generate(),
    url: `/route-name/${shortid.generate()}-${shortid.generate()}`
  };
  client.write('http')
    .tag(tags)
    .field(fields)
    .queue();
  if (client.writeQueueLength > maxQueueSize) {
    const count = client.writeQueueLength;
    client.syncWrite()
      .then(() => console.info(`sync write queue(${count}) success`))
      .catch(err => console.error(`sync write queue fail, ${err.message}`));
    maxQueueSize = _.random(500, 1000);
  }
  setTimeout(writePoint, _.random(0, 1));
}

if (cluster.isMaster) {
  for (let i = 0; i < 8; i++) {
    cluster.fork({
      NAME: processNames[i],
    });
  }
} else {
  writePoint();
}
