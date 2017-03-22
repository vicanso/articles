const Influx = require('influxdb-nodejs');
const client = new Influx('http://127.0.0.1:8086/mydb');
const _ = require('lodash');

setInterval(() => client.syncWrite(), 10 * 1000);

function addHTTPStats() {
  const use = 5000 - _.random(0, 5000);
  const spdy = _.sortedIndex([10, 100, 300, 1000, 3000], use);
  const code = _.random(200, 599);
  client.write('http')
    .tag('device', _.sample(['pc', 'mobile', 'mobile']))
    .tag('method', _.sample(['GET', 'GET', 'GET', 'GET', 'POST', 'POST', 'PUT', 'DELETE']))
    .tag('spdy', spdy)
    .tag('type', ((code / 100) | 0))
    .field({
      url: '/users/me',
      code: `${code}i`,
      contentLength: `${_.random(0, 3000)}i`,
      use: `${use}i`,
      ip: '8.8.8.8',
    })
    .queue();
  setTimeout(addHTTPStats, _.random(0, 1000));
}

function addUserActionStats() {
  client.write('order')
    .tag({
      category: _.sample(['玄幻', '科幻', '言情', '军事', '游戏']),
      free: _.sample([true, false, false]),
      vip: _.sample([true, false, false, false]),
      source: _.sample(['home', 'home', 'home', 'hot', 'hot', 'list', 'search']),
    })
    .field({
      name: '书名',
      author: '作者',
      amount: _.random(1, 100),
      account: 'vicanso',
    })
    .queue();

    client.write('subscription')
      .tag({
        category: _.sample(['玄幻', '科幻', '言情', '军事', '游戏']),
        free: _.sample([true, false, false]),
        vip: _.sample([true, false, false, false]),
        source: _.sample(['home', 'home', 'home', 'hot', 'hot', 'list', 'search']),
      })
      .field({
        name: '书名',
        author: '作者',
        account: 'vicanso',
      })
      .queue();
  setTimeout(addUserActionStats, _.random(3 * 1000, 60 * 1000));
}

function addTrackers() {
  client.write('tracker')
    .tag({
      category: _.sample(['like', 'like', 'like', 'purchase']),
      result: _.sample(['success', 'success', 'success', 'fail']),
    })
    .field({
      use: _.random(0, 1000),
      id: _.random(1000, 10000),
      ip: '8.8.8.8',
      token: 'X8EWU1281',
    })
    .queue();
  setTimeout(addTrackers, _.random(5 * 1000, 30 * 1000));
}

addHTTPStats();
addUserActionStats();
addTrackers();
