# h2c

HTTP2已经在绝大部分的客户端中支持（浏览器或APP），当外网服务已全部支持http2之后，我们开始考虑内部服务间的调用，最开始直接使用基于tls的认证，内部服务的调用连接复用性很高，tls的处理并没有太影响性能。由于各类原因内部访问需要切换回http的形式，因此考查了h2c的处理方式，发现改造成本比想像中低太多，仅需简单添加几行代码则可支持。

下面是调整后的代码，调整后服务器能支持http1与http2两种形式，客户端调用则是强制指定使用http2。
```go
package main

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/vicanso/elton"
	"github.com/vicanso/elton/middleware"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

var http2Client = &http.Client{
	// 强制使用http2
	Transport: &http2.Transport{
		// 允许使用http的方式
		AllowHTTP: true,
		// tls的dial覆盖
		DialTLS: func(network, addr string, cfg *tls.Config) (net.Conn, error) {
			return net.Dial(network, addr)
		},
	},
}

func main() {
	go func() {
		time.Sleep(time.Second)
		resp, err := http2Client.Get("http://127.0.0.1:3000/")
		if err != nil {
			panic(err)
		}
		fmt.Println(resp.Proto)
	}()

	e := elton.New()

	e.Use(middleware.NewDefaultResponder())

	e.GET("/", func(c *elton.Context) error {
		c.Body = "Hello, World!"
		return nil
	})
	// http1与http2均支持
	e.Server = &http.Server{
		Handler: h2c.NewHandler(e, &http2.Server{}),
	}

	err := e.ListenAndServe(":3000")
	if err != nil {
		panic(err)
	}
}
```

## proxy

现在使用的反向代理，大部分都是仅使用http的方式，如果切换为使用http2是否能达到更好的性能。

支持h2c的服务：
```go
package main

import (
	"bytes"
	"flag"
	"net/http"

	"github.com/vicanso/elton"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

var enableHTTP2 bool

func main() {
	flag.BoolVar(&enableHTTP2, "http2", false, "enable http2")
	flag.Parse()

	e := elton.New()

	e.GET("/", func(c *elton.Context) error {
		c.BodyBuffer = bytes.NewBufferString("Hello, World!")
		return nil
	})
	if enableHTTP2 {
		e.Server = &http.Server{
			Handler: h2c.NewHandler(e, &http2.Server{}),
		}
	}

	err := e.ListenAndServe(":3000")
	if err != nil {
		panic(err)
	}
}
```

使用http2转发的代理服务（对外提供的还是http服务）：

```go
package main

import (
	"crypto/tls"
	"flag"
	"net"
	"net/url"

	"github.com/vicanso/elton"
	"github.com/vicanso/elton/middleware"
	"golang.org/x/net/http2"
)

var enableHTTP2 bool

func main() {
	flag.BoolVar(&enableHTTP2, "http2", false, "enable http2")
	flag.Parse()
	e := elton.New()

	target, _ := url.Parse("http://127.0.0.1:3000")

	config := middleware.ProxyConfig{
		Target: target,
	}
	if enableHTTP2 {
		config.Transport = &http2.Transport{
			// 允许使用http的方式
			AllowHTTP: true,
			// tls的dial覆盖
			DialTLS: func(network, addr string, cfg *tls.Config) (net.Conn, error) {
				return net.Dial(network, addr)
			},
		}
	}

	e.GET("/*", middleware.NewProxy(config))

	err := e.ListenAndServe(":3001")
	if err != nil {
		panic(err)
	}
}
```

不经过代理的压测：
```bash
wrk 'http://127.0.0.1:3000/'
Running 10s test @ http://127.0.0.1:3000/
  2 threads and 10 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency   125.79us   39.80us   2.51ms   83.81%
    Req/Sec    34.40k     3.41k   51.13k    74.75%
  691033 requests in 10.10s, 85.67MB read
Requests/sec:  68419.86
Transfer/sec:      8.48MB
```

经过代理(http2)的压测：
```bash
wrk 'http://127.0.0.1:3001/'
Running 10s test @ http://127.0.0.1:3001/
  2 threads and 10 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency   503.05us  181.08us   4.34ms   74.34%
    Req/Sec     9.91k     0.93k   12.01k    74.75%
  199120 requests in 10.10s, 24.69MB read
Requests/sec:  19714.88
Transfer/sec:      2.44MB
```

经过代理(http1)的压测
```bash
wrk 'http://127.0.0.1:3001/'
Running 10s test @ http://127.0.0.1:3001/
  2 threads and 10 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.01ms    3.39ms  62.64ms   98.40%
    Req/Sec     7.73k     0.97k    8.94k    87.50%
  153890 requests in 10.00s, 19.08MB read
Requests/sec:  15382.86
Transfer/sec:      1.91MB
```

上面的结果可以看出，使用http2转发的形式，性能上的损耗的确少一些。