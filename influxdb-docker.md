# influxdb docker

- 启动influxdb（无需认证）

```bash
docker run \
  -d --restart=always \
  -p 7986:8086 \
  -v /data/influx/alpha:/var/lib/influxdb \
  --name=alpha influxdb:alpine
```

- 登录influxdb，设置用户名密码

```bash
docker exec -it alpha influx

CREATE USER "admin" WITH PASSWORD 'password' WITH ALL PRIVILEGES
```

- 重新以认证的方式启动influxdb

```bash
docker stop alpha && docker rm alpha

docker run \
  -d --restart=always \
  -p 7986:8086 \
  -e INFLUXDB_HTTP_AUTH_ENABLED=true \
  -v /data/influx/alpha:/var/lib/influxdb \
  --name=alpha influxdb:alpine
```

- 创建数据库

```bash
docker exec -it alpha influx

AUTH admin password

# 创建数据库
CREATE DATABASE telegraf
# 根据需要设置数据库的保存时间（尽量按需要调整，避免保存了过期的统计数据）
CREATE RETENTION POLICY "one_week" ON "telegraf" DURATION 1w REPLICATION 1 DEFAULT
```

- 创建只读、只写用户

```bash
# 只可读
CREATE USER "reader" WITH PASSWORD '123456' 
GRANT READ ON "telegraf" TO "reader"

# 只可写
CREATE USER "writer" WITH PASSWORD '123456' 
GRANT WRITE ON "telegraf" TO "writer"

# 所有权限
CREATE USER "user" WITH PASSWORD '123456' 
GRANT ALL ON "telegraf" TO "user"

```