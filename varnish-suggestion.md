# 善用HTTP缓存利器-Varnish

在日常的WEB开发中，我们会经常性的使用缓存，而缓存的方式有多种多样（如数据库缓存，接口缓存，函数缓存等等），一般而言，越接近使用者缓存越高效。对于`REST`架构的WEB开发，使用`HTTP`缓存则是提升系统性能的首要手段。

本文将通过讲解如何使用`varnish`，以及如何配置才能让`varnish`变得更加通用合理。

## 强悍的性能表现

Varnish has a modern architecture and is written with performance in mind. It is usually bound by the speed of the network, effectively turning performance into a non-issue. You get to focus on how your web applications work and you can allow yourself, to some degree, to care less about performance and scalability. 一直以来，我都觉得这句话极其简单的概括了`varnish`性能上的强悍，在我的实践中，对于`HTTP`缓存的处理的确瓶颈是在网络上，而非`varnish`或者其它的硬件瓶颈。

我使用自己的`HP Gen8`做了一次测试（未对系统做调做优，也只是本机压本机），请求5KB（gzip之后）的数据，`siege -c 2000 -t 1m "http://127.0.0.1:8001/"`，CPU Usage 在5%以下

```
Transactions:		      238538 hits
Availability:		      100.00 %
Elapsed time:		       59.81 secs
Data transferred:	     1171.79 MB
Response time:		        0.00 secs
Transaction rate:	     3988.26 trans/sec
Throughput:		       19.59 MB/sec
Concurrency:		        5.06
Successful transactions:      238538
Failed transactions:	           0
Longest transaction:	        0.20
Shortest transaction:	        0.00
```



## 缓存TTL的创建

使用`varnish`，首先需要了解缓存ttl的创建，以前一直没有很清晰的了解，在官方的文档中也没看到相关的说明（有可能我遗漏了），后面看了一下`varnish`的代码，找到以下的代码，从代码中能了解到ttl是怎么创建的：

```c
void
RFC2616_Ttl(struct busyobj *bo, double now, double *t_origin,
    float *ttl, float *grace, float *keep)

  ...

  default:
    *ttl = -1.;
    break;
  case 302: /* Moved Temporarily */
  case 307: /* Temporary Redirect */
    /*
     * https://tools.ietf.org/html/rfc7231#section-6.1
     *
     * Do not apply the default ttl, only set a ttl if Cache-Control
     * or Expires are present. Uncacheable otherwise.
     */
    *ttl = -1.;
    /* FALL-THROUGH */
  case 200: /* OK */
  case 203: /* Non-Authoritative Information */
  case 204: /* No Content */
  case 300: /* Multiple Choices */
  case 301: /* Moved Permanently */
  case 304: /* Not Modified - handled like 200 */
  case 404: /* Not Found */
  case 410: /* Gone */
  case 414: /* Request-URI Too Large */
    /*
     * First find any relative specification from the backend
     * These take precedence according to RFC2616, 13.2.4
     */

    if ((http_GetHdrField(hp, H_Cache_Control, "s-maxage", &p) ||
        http_GetHdrField(hp, H_Cache_Control, "max-age", &p)) &&
        p != NULL) {

      if (*p == '-')
        max_age = 0;
      else
        max_age = strtoul(p, NULL, 0);

      *ttl = max_age;
      break;
    }

    /* No expire header, fall back to default */
    if (h_expires == 0)
      break;


    /* If backend told us it is expired already, don't cache. */
    if (h_expires < h_date) {
      *ttl = 0;
      break;
    }

    if (h_date == 0 ||
        fabs(h_date - now) < cache_param->clock_skew) {
      /*
       * If we have no Date: header or if it is
       * sufficiently close to our clock we will
       * trust Expires: relative to our own clock.
       */
      if (h_expires < now)
        *ttl = 0;
      else
        *ttl = h_expires - now;
      break;
    } else {
      /*
       * But even if the clocks are out of whack we can still
       * derive a relative time from the two headers.
       * (the negative ttl case is caught above)
       */
      *ttl = (int)(h_expires - h_date);
    }
  }

  ...

}
```
从上面的代码可以看出，只对于特定的`HTTP Status Code`，才会根据`Cache-Control`或者`Expires`来设置缓存时间，非上述状态码的响应，就算是设置了也无效。`Cache-Control`中可以设置max-age与s-maxage分别配置客户端缓存与`varnish`缓存ttl的不同（至于后面的Expires我不使用该字段，也不建议大家使用）。

## 缓存KEY的生成与配置

varnish的缓存是根据什么来保存的，怎么区分是否同一个缓存？对于这个问题，最简单的方式就是直接上`vcl_hash`的配置说明：

```
sub vcl_hash{
  hash_data(req.url);
  if (req.http.host) {
    hash_data(req.http.host);
  } else {
    hash_data(server.ip);
  }
  return (lookup);
}
```

由上面的配置可以看出，`varnish`是使用请求的url + 请求的HTTP头中的host，如果没有host，则取服务器的ip。这里需要注意，尽量保证经过`varnish`的请求都有Host，如果是直接取`server.ip`，对于多backend的应用，就会导致每个backend的缓存都会保存一份。当然如果你能保证该`varnish`只是一个应用程序使用，只需要根据`req.url`部分就能区分，那么可以精简`vcl_hash`的判断（不建议）：

```
sub vcl_hash{
  hash_data(req.url);
  return (lookup);
}
```

也可以增加更多的字段来生成缓存key，如根据不同的user-agent来生成不同的缓存：

```
sub vcl_hash{
  hash_data(req.url);
  hash_data(req.http.User-Agent);
  if (req.http.host) {
    hash_data(req.http.host);
  } else {
    hash_data(server.ip);
  }
  return (lookup);
}
```

知道`varnish`的缓存key生成方式之后，下面来看以下问题：

- `/books?type=it&limit=2` 与 `/books?limit=2&type=it` 这两个url是否使用同一份缓存
- 如果有人恶意的使用不同的参数，那么是不是导致`varnish`的缓存会一直在增加（后面会说我曾经遇到过的场景）

对于第一个问题，两个url被认为是不相同的，使用的缓存不是同一份，那么这个应该怎么解决呢？`varnish`提供了`querysort`的函数，使用该函数在`vcl_recv`中将`req.url`重新调整则可。

那么第二个问题呢？`varnish`上为了保证配置文件的通用性，不应该对请求的参数做校验，所以我使用的方式是在后端对参数做严格的校验，不符合的参数（有多余的参数）都直接响应失败。

注：大家是否都想去试试通过增加时间戳的方式请求别人的`varnish`，把别人的`varnish`挤爆？如果大家想试，最好试自己的`varnish`就好，大家可能会发现，响应的请求数据大部分才几KB，过期时间也不会很长，内存又大，还没挤完，旧的就已过过期了。^-^

## 使用过程中不当的配置方式

使用`varnish`做缓存来提升系统的并发能力，它配置简单，性能强悍，因此很多后端开发者都喜欢使用它，但是很多人都没有真正的使用好，配置文件复杂且无法通用

- 使用了非通用的配置来指定url是否可以缓存

  我在最开始使用`varnish`的时候，在`vcl_recv`中判断`req.url ~ "/users/"`则`pass`，每次配置的时候都要和后端开发定义好一系列的规则来判断请求是否能缓存，规则越来越多，越来越复杂，最后只能是无法维护，每次修改心惊胆颤，相看两生厌。

- 缓存的时间使用`default_ttl`，而非通过响应头的`Cache-Control`来定义

  最开始的时候与后端开发定义好，`defualt_ttl`为300s，觉得这能满足了普遍的情况，慢慢各类的缓存请求越来越多而且各自对缓存时间的要求不一，发现`default_ttl`已经基本没有意义了，还容易因为后端未设置好，把本不该缓存的请求缓存了（可以缓存的请求未缓存，只是性能降低，把不能缓存的请求缓存了，就有可能导致某些用户数据出错了），最后设置为0，缓存时间全部通过接口响应的`Cache-Control`来调整，未设置的则以不可缓存请求来处理

- 对于max-age较长的响应（如静态文件），未合理使用s-maxage

  对于静态文件（文件名中带有版本号，jquery-1.11.js），希望在客户端缓存的时间越长越好，因此后端响应该请求的时候设置了一年的缓存时间：`max-age=31536000`。本来这是挺合理的，但是因为该请求也经过了`varnish`而被`varnish`缓存起来了，一开始我也没发现有什么不好之处。后来有一天`varnish`占用的内存一直在涨，才发现原来有人恶意请求静态文件，通过添加后缀`?t=xxxx`这样，导致请求相同的静态文件，但是由于url不一致，每次都生成了新的缓存，一直涨一直涨...后端调整代码，对于响应`max-age`超过3600的，要求设置`s-maxage`。（本来更应该是后端对接口参数做更严格的检查，如果有多余参数返回出错400）


## 打造更通用合理的配置

### 不可缓存的请求的处理

`varnish`中判断请求不可缓存的方式有两种，一种是在`vcl_recv`处理函数中定义规则对哪些HTTP请求不做缓存，还有一种就是在`vcl_backend_response`设置该请求的响应为`uncacheable`（hit_for_pass），并设置`ttl`。这两种方式中，第一种方式效率更高，我一开始使用的时候，经常是每多一个（一类）请求，就增加一条判断（上面所说的不当配置），如：

```
sub vcl_recv {

  ...

  if(req.url ~ "/users/" || req.url ~ "/fav/book") {
    return (pass);
  }

  ...

}
```

后来发现这种做法实在是太麻烦了，在使用`varnish`时，希望多个项目可以共享，因此配置文件是公共的，每个项目的url规则不一，配置越来越多，简直有点无从管理了。后续开始偷懒，调整为后一种方式，要求后端对所有响应的请求都必须设置`Cache-Control`字段，通过该字段来判断该请求是否可用，配置文件如下：

```
sub vcl_backend_response {

  ...

  # The following scenarios set uncacheable
  if (beresp.ttl <= 0s ||
    beresp.http.Set-Cookie ||
    beresp.http.Surrogate-Control ~ "no-store" ||
    (!beresp.http.Surrogate-Control &&
      beresp.http.Cache-Control ~ "no-cache|no-store|private") ||
    beresp.http.Vary == "*"){
    # Hit-For-Pass
    set beresp.uncacheable = true;
    set beresp.ttl = 120s;
    set beresp.grace = 0s;
    return (deliver);
  }

  ...

}
```

通过各后端配置HTTP响应头来判定缓存的使用问题，使用了一段时间，并没有发现有什么异常之处，但是总觉得这种判断有点事后补救的方式，因为很多请求在使用的时候就已经知道该请求是不能缓存的，因此完善了一下`vcl_recv`的配置，调整为：

```
sub vcl_recv {

  ...

  # no cache request
  if(req.http.Cache-Control == "no-cache" || req.url ~ "\?cache=false" || req.url ~ "&cache=false"){
    return (pass);
  }

  ...

}
```
调整之后，提供了通用的方式可以直接在`vcl_recv`阶段直接不使用缓存，在开发者调用接口的时候，如果确认该请求是不可缓存的，则设置HTTP请求头的`Cache-Control:no-cache`（建议使用此方式）或者增加url query的方式，经过此调用之后，对于不可缓存的请求的处理已经是一种通用的模式，`varnish`对接的是多少个应用也不再需要重复配置了。对于上面这样的配置，存在两个问题（如果有恶意调用或者调用出错）：

- 对于不可缓存请求，如果请求时没有添加`Cache-Control:no-cache`或者`cache=false`的query参数，会导致无法在`vcl_recv`阶段做判断

  对于这个问题，我使用的解决方案是：对于不可缓存请求的处理，在后端应用程序的处理函数中，对于`Cache-Control:no-cache`或者`cache=false`的query参数做校验，如果无此参数，则返回出错信息

- 对于可缓存请求，如果请求时添加`Cache-Control:no-cache`或者`cache=false`的query参数，会导致无法在`vcl_recv`阶段判断为是不可缓存请求，直接`pass`到`backend`

  对于这个问题，我使用的解决方案和上面的类似：对于可缓存请求，在后端应用程序的处理函数中，对于`Cache-Control:no-cache`或者`cache=false`的query参数做校验，如果有此参数，则返回出错信息

### 使用m-stale提升过期数据的响应

在真实使用的环境中，数据在刚过期的期间（如2秒以内），为了更好的响应速度，我希望能够直接使用刚过期数据返回（因为刚过期，时效性还是能保证的），同时去更新缓存的数据，因此调整`vcl_hit`的配置，从`Cache-Control`中获取`m-stale`：

```
sub vcl_hit {

  ...

  # backend is healthy
  if (std.healthy(req.backend_hint)) {
    # set the stale
    if(obj.ttl + std.duration(std.integer(regsub(obj.http.Cache-Control, "[\s\S]*m-stale=(\d)+[\s\S]*", "\1"), 2) + "s", 2s) > 0s){
      return (deliver);
    }
  }

  ...

}
```


### 当backend挂了的时候，暂时使用过期的缓存数据响应

`varnish`可以配置如果当`backend`挂了的时候，使用过期的数据先响应（因为一般缓存的数据都是用于首页之类的展示，与用户无关的数据），这样可以避免所有接口都出错，用户看到空白出错页面

```
sub vcl_hit {
  ...

  if (std.healthy(req.backend_hint)) {
    ...
  } else if (obj.ttl + obj.grace > 0s) {
    # Object is in grace, deliver it
    # Automatically triggers a background fetch
    return (deliver);
  }

  ...

}
```



### 后端响应不要设置过长的缓存时间

对于这个问题，首先需要明确一点是：`varnish`是用于提高多并发下的性能，尽量不要把它当成是提升接口的性能的工具（如某个接口的响应时间需要5秒，通过一个定时程序去定时调用，让它一直在varnish中有缓存），所以在使用时首先要保障的是后端接口的性能是高效的。

对于数据的缓存，我刚开始使用的时候，也是有多长时间设置多长时间的，后来发现，其实完全没有这个必要，请求`/books`，如果设置`Cache-Control:max-age=3600`，那么的确是3600秒才请求backend一次，但是如果我设置为`Cache-Control:max-age=3600, s-maxage=60`，对于`backend`每60秒会请求一次与每个小时请求一次对其性能压力并没有什么区别。那么后一种配置有什么好处呢？首先避免占用过高的内存使用（如果该接口并非频繁请求），其次我自己在使用过程中的确出现过由于人为原因配置了错误的数据，导致接口缓存数据错误，需要手工清除缓存的情况，找出所有可能影响的url（影响的url有可能很多，无法保证是否遗漏）一一清除，这是很浪费时间而且容易出错的事情，而使用短时间的缓存则很快会刷新，不用手工清理。（我自己的使用实践是基本不会设置s-maxage超过300s）

### 合理使用Hit-For-Pass

当有并发的请求到`varnish`时，如果在`vcl_recv`阶段无法判断该请求是否可以缓存，那么只会有一个请求发送到`backend`，其它的请求进入队列等待。

- 请求后端响应的结果是该请求可以缓存

  那么将队列中等待的请求将会将响应的数据复制，并一一响应给其对应的客户端。

- 请求的后端响应是不可缓存的（Set-Cookie、max-age=0 等由服务器端返回的数据设置不能缓存的）

  那么将队列中等待的所有请求都会发送到`backend`，各自根据响应返回给其对应的客户端。这里就存在了一个问题，如果第一次请求响应很慢，那么有可能会堆积较多的请求，到时会一并请求到后端，导致后端的压力增大，这也是上面所说，如果不能缓存的请求，尽量添加HTTP请求头`Cache-Control:no-cache`的其中一个原因。假如在现有系统，无法做大的改造，那么如果不能缓存的请求，只能使用后端设置的方式，那么有没办法能优化性能呢？是有的，这就是`Hit-For-Pass`，看如下配置：

```
sub vcl_backend_response {

  ...

  # The following scenarios set uncacheable
  if (beresp.ttl <= 0s ||
    beresp.http.Set-Cookie ||
    beresp.http.Surrogate-Control ~ "no-store" ||
    (!beresp.http.Surrogate-Control &&
      beresp.http.Cache-Control ~ "no-cache|no-store|private") ||
    beresp.http.Vary == "*"){
    # Hit-For-Pass
    set beresp.uncacheable = true;
    set beresp.ttl = 120s;
    set beresp.grace = 0s;
    return (deliver);
  }

  ...

}
```

`Hit-For-Pass` 的请求是会缓存在`varnish`中，但是当命中缓存的时候，不是直接将数据返回，而是使用`pass`的方式，把请求转向`backend`，那么在后续相同的请求进来的时候，就可以快速的判断该请求是`pass`的。下面我们再来考虑一下问题，请求本应该是可以缓存的，但是因为后端出错（数据库挂了，或者其它原因），导致接口的响应状态码为`500`，那么所有相同的请求都会转向`backend`，那么压力就会增大，有可能导致后端程序直接挂了（因为请求有可能因为出错的原因突然并发量很大），因此还需要后端程序做好流控之类的限制。

### 出错的请求也做缓存

可能会有一些这样的场景，如果接口出错了，也希望直接把出错的响应直接缓存，后续使用出错的数据响应给客户端，那么是否也可以做这样的调整呢？是的，可以做这样的调整（但我不建议），看如下配置：

```
sub vcl_backend_response {
  if (beresp.status == 500 && beresp.http.Force-Caching) {
  	set beresp.uncacheable = false;
    set beresp.ttl = 120s;
    return (deliver);
  }

  ...

}
```
在`vcl_backend_response`开始位置增加，如果`status == 500`，并且响应头设置了`Force-Caching`，那么将该请求缓存设置为可以缓存`120s`，后续相同的请求在`120s`时间内，将使用出错的数据响应，可以减缓出错时后端应用程序的压力。

### 下面列举使用上述配置之后，不同类型的HTTP请求响应流程

#### 不可缓存的请求

- POST/PUT等请求 `vcl_recv` --> `vcl_hash` --> `vcl_pass` --> `vcl_backend_fetch` --> `vcl_backend_response` --> `vcl_deliver`

- 请求头中Cache-Control:no-cache或者url中query参数带有cache=false `vcl_recv` --> `vcl_hash` --> `vcl_pass` --> `vcl_backend_fetch` --> `vcl_backend_response` --> `vcl_deliver`

- HTTP Status Code 不属于 202、203、204、300、301、302、304、307、404、410、414，响应头设置Cache-Control也无用 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_backend_response` (在此会设置hit-for-pass的ttl)--> `vcl_deliver`

- Set-Cookie、max-age=0 等由服务器端返回的数据设置不能缓存的，`vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_backend_response` (在此会设置hit-for-pass的ttl)--> `vcl_deliver`

#### 可缓存的GET/HEAD请求

GET /cache/max-age/60 返回数据设置Cache-Control:public, max-age=60

- 无缓存，数据从backend中拉取 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_backend_response` --> `vcl_deliver`

- 有缓存且未过期，从缓存中返回，X-Hits + 1  `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver`

- 有缓存且已过期，backend正常，过期时间未超过stale(3s)，从缓存中返回，且从backend中拉取数据更新缓存  `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver` --> `vcl_backend_fetch` --> `vcl_backend_response`

- 有缓存且已过期(也超过stale)，backend正常，从backend中拉取数据更新缓存 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_backend_response` --> `vcl_deliver`

- 有缓存且已过期，backend挂起，过期时间未超过grace(60s)，从缓存中返回 `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver` --> `vcl_backend_fetch`

- 有缓存且已过期，backend挂起，过期时间超过grace(60s)，Backend fetch failed `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_deliver`



### varnish-generator

遵循上面所说的可缓存与不可缓存的请求配置处理，我定义好了一套`varnish`的模板配置，每次新的项目启动之前，都要求实现上面所说的规则，在正式上线的时候，只需要增加`backend` 的配置就可以了，摆脱了每个项目都要各自配置自己的`varnish`，而且后期维护不方便的局面。对此我写了一个`node.js`的模块[varnish-generator](https://github.com/vicanso/varnish-generator)，根据`backend`配置来生成对应的`vcl`，以后只需要关注如下的服务器配置：

```json
{
  "name": "varnish-test",
  "stale": 2,
  "directors": [
    {
      "name": "timtam",
      "prefix": "/timtam",
      "director": "fallback",
      "backends": [
        {
          "ip": "127.0.0.1",
          "port": 3000
        },
        {
          "ip": "127.0.0.1",
          "port": 3010
        }
      ]
    },
    {
      "name": "dcharts",
      "prefix": "/dcharts",
      "host": "dcharts.com",
      "director": "hash",
      "hashKey": "req.http.cookie",
      "backends": [
        {
          "ip": "127.0.0.1",
          "port": 3020,
          "weight": 5
        },
        {
          "ip": "127.0.0.1",
          "port": 3030,
          "weight": 3
        }
      ]
    },
    {
      "name": "vicanso",
      "host": "vicanso.com",
      "director": "random",
      "backends": [
        {
          "ip": "127.0.0.1",
          "port": 3040,
          "weight": 10
        },
        {
          "ip": "127.0.0.1",
          "port": 3050,
          "weight": 5
        }
      ]
    },
    {
      "name": "aslant",
      "backends": [
        {
          "ip": "127.0.0.1",
          "port": 8000
        }
      ]
    }
  ]
}
```
## 建议

对于缓存的使用，一开始不要过早的加入，特别注意是使用缓存要先考虑清楚是会有可能缓存了不可缓存的内容。缓存能提升系统性能，但也有可能导致数据错误了，请谨慎。最后，如果大家有什么疑问可以在[issue](https://github.com/vicanso/articles/issues/1)中提出。如果需要网上生成varnish配置文件，可以使用[http://aslant.site/varnish-generator/]( http://aslant.site/varnish-generator/)在线生成。
