# 统计-监控-预警一体化

随着业务的增长，公司的服务器从原来的5台增加到现在的差不多20台，本来计划是有专门的运维来管理的，谁知道老板居然说需要跟潮流，需要以`DevOps`的形式管理团队。没钱就直说嘛，还使劲的吹，最终没办法，还是只能自己开搞了。

## 需求汇总

刚好运营那边也反馈系统真的不太稳定而且性能不好，相关的用户数据也欠缺，一堆的事情都过来了。当时想着这些最终都是要解决的问题，而且项目越来越大，对于一些性能的统计分析，监控也迫在眉睫，于是就想能不能一次把这些问题都汇总解决了（每次出问题都要靠客户反馈，开发一点都不知道，自己想想实在是太尴尬）。

### 监控需求

- 能收集机器基本性能指标（CPU Usage, Memory Usage, Disk Usage, Swap, Network等）
- 对现使用的常用的软件收集其性能指标（haproxy varnish mongodb redis docker）
- 对现有域名的DNS解析，现有HTTP Server的Ping检测
- 对收集的指标数据，能实现以图表的形式展示，以及对特定时间段筛选展示（最少1个月）
- 能够设定条件阀值，符合条件的时候，能触发预警（邮箱，短信等）

### 业务需求

- 能将各业务统计指标数据化，图表化
- 能提供简便的工具，方便运营人员简单的去筛选数据
- 能提供简单常用的数据处理功能（平均值，求和，次数，去重，分组计算等）
- 能针对特定场景设置条件阀值（如某个活动最近1个小时，参与人数小于多少）触发提示（邮箱，短信等），方便运营人员及时跟踪

### 开发需求

- 能支持自定义生成各类统计数据，方便应用程序生成自己的性能统计
- 统计数据的收集非阻塞式，不影响现有业务的场景
- 能通过统计数据设定阀值，自动生成预警
- 最好有支持多种语言的统计数据生成`sdk`，最少要支持`nodejs`与`java`
- 能够设定条件阀值，符合条件的时候，能触发预警（邮箱，短信等），不希望每次出问题都只能客户反馈再去排查

## influxdata-TICK

收集完需求汇总之后，完全没法下手，真是『书到用时方恨少』，都不知道要怎么才能满足大家的需求，想过自己动手去开发，不说时间少，而且能力不足，不想自己挖坑自己跳。刚好这时想起了我力推公司使用的`influxdb`，它是能满足了数据的存储，分析等需求，但是收集还有预警还需要考虑怎么做。一开始还想要不自己去开发，后来想起`influxdata`是有四件套`TICK`，还有两个没怎么用过，印象中好像就是能收集数据与分析的，立即上去研究一翻，还真是柳暗花明又一村。

### Telegraf

`telegraf` is a plugin-driven server agent for collecting and reporting metrics. 在看了`Telegraf`的介绍之后，它能很方便的把一些性能指标收集之后输入到各类数据库、消息队列等（当然我肯定首先influxdb）。再看了一下已实现的`input plguin`有几十个，已经覆盖了常用的各类服务端软件（包括公司使用到的haproxy varnish mongodb redis docker），而且还能对`DNS`和`Ping`检测，在此对于监控的数据收集已经是甚于满足了，而且其配置简单，下面是机器性能与`mongodb`的性能收集配置：

```
[[inputs.cpu]]
  ## 机器CPU性能收集配置
  ## 是否记录每个CPU的性能
  percpu = true
  ## 是否记录整个系统的CPU性能
  totalcpu = true
  ## 是否需要收集原始的CPU时间指标（一般我们都是不需要）
  collect_cpu_time = false

## 下面的配置都是telegraf自带的配置就有，因此不详细说明

# Read metrics about disk usage by mount point
[[inputs.disk]]
  ...


# Read metrics about disk IO by device
[[inputs.diskio]]
  ...

# Get kernel statistics from /proc/stat
[[inputs.kernel]]
  ...

# Read metrics about memory usage
[[inputs.mem]]
  ...

# Get the number of processes and group them by status
[[inputs.processes]]
  ...

# Read metrics about swap memory usage
[[inputs.swap]]
  ...

# Read metrics about system load & uptime
[[inputs.system]]
  ...
  
# Read metrics from one or many MongoDB servers
[[inputs.mongodb]]
  servers = ["mongodb://mongodb://username:password@10.XX.XX.XX:27101/mydatabase?authSource=admin"]
  # 是否要收集各db的性能分析数据
```

在配置好`telegraf.conf`之后，启动之后就不用关心各数据的收集了。机器硬件的相关性能需要在每台机器都部署，而数据库之类的，则专门选择一台机器来通过接口来收集则可以。在这里要吐槽一下`varnish`，居然没有提供接口来直接获取性能指标，还需要直接使用自带的`varnishstat`程序，太差了，差评。

运行10几分钟之后，在`grafana`在配置了一下，每台机器的CPU、Memory等等的使用率就出来了，还有`mongodb` `redis`等等各类数据库或者软件的性能指标也可以直接通过曲线图看着，终于摆脱几个监控软件一起看的局面了。

### Influxdb

对于`influxdb`介绍大家可以阅读我之前的文章，[使用influxdb有感](https://github.com/vicanso/articles/blob/master/best-statistics.md)。

### Chronograf

`chronograf`在数据展示上个人觉得没有[grafana](https://github.com/grafana/grafana)好，建议大家还是使用`grafana`就好。当然如果大家给面子可以试试我个人开发的[aslant](https://github.com/vicanso/aslant)

下面是几张性能的展示图：

![](assets/stats-monitor-warning-01.png)

### Kapacitor

`kapacitor`可以通过对`influxdb`中的数据进行分析处理，它提供了丰富的函数可以自定义不同的条件，根据符合的阀值，输出日志、输出警告到`slack`、POST数据至HTTP endpoint、执行脚本等等各类触发条件。下面是一个配置的示例：

```
stream
    |from()
        .measurement('cpu')
    // create a new field called 'used' which inverts the idle cpu.
    |eval(lambda: 100.0 - "usage_idle")
        .as('used')
    |groupBy('service', 'datacenter')
    |window()
        .period(1m)
        .every(1m)
    // calculate the 95th percentile of the used cpu.
    |percentile('used', 95.0)
    |eval(lambda: sigma("percentile"))
        .as('sigma')
        .keep('percentile', 'sigma')
    |alert()
        .id('{{ .Name }}/{{ index .Tags "service" }}/{{ index .Tags "datacenter"}}')
        .message('{{ .ID }} is {{ .Level }} cpu-95th:{{ index .Fields "percentile" }}')
        // Compare values to running mean and standard deviation
        .warn(lambda: "sigma" > 2.5)
        .crit(lambda: "sigma" > 3.0)
        .log('/tmp/alerts.log')

        // Post data to custom endpoint
        .post('https://alerthandler.example.com')

        // Execute custom alert handler script
        .exec('/bin/custom_alert_handler.sh')

        // Send alerts to slack
        .slack()
        .channel('#alerts')

        // Sends alerts to PagerDuty
        .pagerDuty()

        // Send alerts to VictorOps
        .victorOps()
```

`kapacitor`对于我而言有点太复杂了，各类的监控预警我希望是不需要懂代码的人就能写得出（主要是运营人员的需求整天都变化，不想天天帮忙写预警），`kapacitor`太强大了，所以只好自己画了一个饼[influxdb-warner](https://github.com/vicanso/influxdb-warner)，通过`yaml`的配置定时去查`influxdb`的数据，需要满足条件则触发预警，示例如下：

```yml
myinfluxdb:
  # the inflxudb host
  host: "127.0.0.1"
  # the influxdb port, default is 8086, [optional]
  port: 8086
  # the influxdb protocol, default is "http", [optional]
  protocol: http
  # the user for influxdb, [optional]
  # user: user
  # the password for influxdb, [optional]
  # password: password
  measurement:
    login:
      -
        # pass the check
        # [optional]
        pass: false
        # day filter, Monday:1, ... Sunday:7
        # [optional]
        # eg: "1-7" means Monday to Sunday
        # eg: ["1-3", "6-7"] means Monday to Wednesday
        # and Saturday to Sunday
        day: "1-7"
        # time filter
        # [optional]
        # eg: "00:00-12:00", or ["00:00-09:00", "13:00-18:00"]
        time: "00:00-24:00"
        # when the check is fail, the warn text
        text: The count of successful login is abnormal
        # the influxdb where conditions
        # [optional]
        where:
          - result = success
        # the start time of influxdb query
        # [optional]
        start: "-5m"
        # the ene time of influxdb query, default is now()
        # [optional]
        # end: "now()"
        # the influxdb function for data
        # [optional]
        func:
          - count(account)
        # check for each series of the result,
        # if the check return true,
        # the warn event will be emited
        check: count < 100
      -
        day: ["1", "2", "3", "4", "5", "6", "7"]
        time: ["00:00-12:00", "12:00-24:00"]
        text: The count of failed login is abnormal
        where:
          - result = fail
        func:
          - count(account)
        check: count > 10
      -
        text: The count of failed login(group by account's type) is abnormal
        group: type
        where:
          - result = fail
        func:
          - count(account)
        check:
          - count > 1 && type === 'vip'
          - count > 1 && type === 'normal'
      -
        day: "1-2"
        text: The check is pass
        pass: true
        check: type === 'test'
```

全部工作都准备好之后，就各应用程序将各自的性能统计指标、业务统计指标接入`influxdb`，让前端开发的做了一个预警录入系统，让运营人员、开发人员自己选择录入预警条件，试运行一个月之后，情况良好，终于摆脱了无统计、无数据的局面。在此感谢强大的[influxdata](https://www.influxdata.com/)。


注：以上情节纯属虚构，如有雷同，纯属巧合
