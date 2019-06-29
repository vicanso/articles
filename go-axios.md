# go-axios入门

## 前言

日常开发中，各服务主要都是REST的形式提供接口服务，因此HTTP Client则是开发中的重中之重。`golang`中自带的HTTP Client已经能满足各类的场景，但是在使用的时候，各依赖服务的调用都基于同一模块，调整相关代码时影响较大，一些老旧系统的出错响应不规范，导致出错处理流程复杂难懂，`go-axios`则由此而生。

[go-axios](https://github.com/vicanso/go-axios)整体思路沿用（抄袭？）`axios`，主要提供实例化的参数配置，提交数据与响应数据的`transform`，发送与响应的拦截器以及可自定义的`Adapter`（用于mock测试）。

## 实例化配置

`go-axios`不提供默认的实例，所有的调用服务都需要自己去实例化，如我们有一个调用百度服务的实例：

```go
package main

import (
	"fmt"

	"github.com/vicanso/go-axios"
)

func main() {
	ins := axios.NewInstance(&axios.InstanceConfig{
		BaseURL: "https://www.baidu.com/",
	})
	resp, err := ins.Get("/")
	fmt.Println(err)
	fmt.Println(resp.Status)
}
```

## 压缩提交数据

一般客户端比较少提交大数据的场景，但是在内部服务间的调用，有部分场景经常需要提交大量的数据，如应用系统的统计汇总，下面的则是针对大于1KB的提交数据进行gzip压缩（还可选择snappy等更快速的压缩算法）的例子：

```go
package main

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"math/rand"
	"net/http"
	"time"

	"github.com/vicanso/go-axios"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

var letterRunes = []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

func randStringRunes(n int) string {
	b := make([]rune, n)
	for i := range b {
		b[i] = letterRunes[rand.Intn(len(letterRunes))]
	}
	return string(b)
}

// doGzip gzip
func doGzip(buf []byte, level int) ([]byte, error) {
	var b bytes.Buffer
	if level <= 0 {
		level = gzip.DefaultCompression
	}
	w, _ := gzip.NewWriterLevel(&b, level)
	_, err := w.Write(buf)
	if err != nil {
		return nil, err
	}
	w.Close()
	return b.Bytes(), nil
}

func main() {
	transformRequest := make([]axios.TransformRequest, 0)
	// 默认的transform request将提交的数据转换为字节
	transformRequest = append(transformRequest, axios.DefaultTransformRequest...)
	transformRequest = append(transformRequest, func(body interface{}, headers http.Header) (data interface{}, err error) {
		key := "Content-Encoding"
		// 已做处理的跳过
		if headers.Get(key) != "" {
			return body, nil
		}
		buf, ok := body.([]byte)
		if !ok {
			return body, nil
		}
		// 少于1KB，不压缩
		if len(buf) < 1024 {
			return body, nil
		}
		gzipBuf, err := doGzip(buf, 0)
		// 压缩失败，则不处理
		if err != nil {
			return body, nil
		}
		headers.Set(key, "gzip")
		return gzipBuf, nil
	})
	ins := axios.NewInstance(&axios.InstanceConfig{
		BaseURL:          "http://localhost:3000/",
		TransformRequest: transformRequest,
	})
	data := map[string]string{
		"account":  randStringRunes(1024),
		"password": randStringRunes(1024),
	}
	resp, err := ins.Post("/", data)
	fmt.Println(err)
	fmt.Println(resp.Status)
}
```

## 请求拦截

如果需要对某个服务停止调用，则可以在请求拦截中处理。我们在管理后台中能针对各接入的服务设置可用的时间段，方便管理，简化的示例代码如下：

```go
package main

import (
	"errors"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/vicanso/go-axios"
)

const (
	// ServiceDisabled service disalbed
	ServiceDisabled = iota
	// ServiceEnabled service enabled
	ServiceEnabled
)

func main() {
	var baiduServerStatus int32
	// 如果时间戳为偶数则设置为可用（实际定时从数据库中相关配置中更新）
	if time.Now().Unix()%2 == 0 {
		atomic.StoreInt32(&baiduServerStatus, ServiceEnabled)
	}

	ins := axios.NewInstance(&axios.InstanceConfig{
		BaseURL: "https://www.baidu.com/",
		RequestInterceptors: []axios.RequestInterceptor{
			func(config *axios.Config) (err error) {
				if atomic.LoadInt32(&baiduServerStatus) != ServiceEnabled {
					err = errors.New("service isn't enabled")
					return
				}
				return
			},
		},
	})
	resp, err := ins.Get("/")
	fmt.Println(err)
	fmt.Println(resp)
}
```

## 性能统计

`go-axios`可启用性能跟踪，包括DNS，TCP连接，首字节等各时间点的统计指标，可在`ResponseInterceptor`中获取这些指标写入统计数据库，示例如下：

```go
package main

import (
	"fmt"

	"github.com/vicanso/go-axios"
)

var (
	aslant = axios.NewInstance(&axios.InstanceConfig{
		BaseURL:     "https://aslant.site/",
		// 启用性能跟踪
		EnableTrace: true,
		ResponseInterceptors: []axios.ResponseInterceptor{
			httpStats,
		},
	})
)

func httpStats(resp *axios.Response) (err error) {
	stats := make(map[string]interface{})
	config := resp.Config
	stats["url"] = config.URL
	stats["status"] = resp.Status

	ht := config.HTTPTrace
	if ht != nil {
		stats["timeline"] = config.HTTPTrace.Stats()
		stats["addr"] = ht.Addr
		stats["reused"] = ht.Reused
	}
	// 可以将相应的记录写入统计数据
	fmt.Println(stats)
	return nil
}

func main() {
	resp, err := aslant.Get("/")
	fmt.Println(err)
	fmt.Println(resp.Status)
}
```

## 出错转换

我们的REST服务出错是返回的HTTP状态码为4xx，5xx，而axios默认只为请求出错时才会返回Error，因此我们需要针对各服务将出错的响应直接转换为相应的Error，简化编码流程，也保证针对出错的正常处理（因为开发者有时会只判断Error，而未判断状态码），示例如下：

```go
package main

import (
	"errors"
	"fmt"

	"github.com/vicanso/go-axios"

	jsoniter "github.com/json-iterator/go"
)

var (
	standardJSON = jsoniter.ConfigCompatibleWithStandardLibrary
)
var (
	aslant = axios.NewInstance(&axios.InstanceConfig{
		BaseURL: "https://ip.aslant.site/",
		ResponseInterceptors: []axios.ResponseInterceptor{
			convertResponseToError,
		},
	})
)

// convertResponseToError convert http response(4xx, 5xx) to error
func convertResponseToError(resp *axios.Response) (err error) {
	if resp.Status >= 400 {
		// 我们标准的响应出错消息记录至message中
		message := standardJSON.Get(resp.Data, "message").ToString()
		if message == "" {
			message = "Unknown Error"
		}
		// 也可自定义出错类
		err = errors.New(message)
	}
	return
}

func main() {
	_, err := aslant.Get("/ip-locations/json/123")
	fmt.Println(err)
}
```

## Mock测试

系统依赖于各种服务，最需要处理的就是如何在测试中不受其它系统的影响，因为需要简单易用的mock方式，示例如下：

```go
package main

import (
	"fmt"

	"github.com/vicanso/go-axios"
)

type (
	// UserInfo user info
	UserInfo struct {
		Account string `json:"account,omitempty"`
		Name    string `json:"name,omitempty"`
	}
)

var (
	aslant = axios.NewInstance(&axios.InstanceConfig{
		BaseURL: "https://aslant.site/",
	})
)

// getUserInfo get user info from aslant.site
func getUserInfo() (userInfo *UserInfo, err error) {
	resp, err := aslant.Get("/users/me")
	if err != nil {
		return
	}
	userInfo = new(UserInfo)
	err = resp.JSON(userInfo)
	if err != nil {
		return
	}
	return
}

// mockUserInfo mock user info
func mockUserInfo(data []byte) (done func()) {
	originalAdapter := aslant.Config.Adapter
	aslant.Config.Adapter = func(config *axios.Config) (resp *axios.Response, err error) {
		resp = &axios.Response{
			Data:   data,
			Status: 200,
		}
		return
	}

	done = func() {
		aslant.Config.Adapter = originalAdapter
	}
	return
}

func main() {
	mockUserInfo([]byte(`{"account":"tree", "name":"tree.xie"}`))
	userInfo, err := getUserInfo()
	fmt.Println(err)
	fmt.Println(userInfo)
}
```

## 小结

[go-axios](https://github.com/vicanso/go-axios)的总体实现较为简单，总体上还是依赖于`http.Client`，更新详细的文档可至github上查阅，如果使用中有任何疑问，欢迎提issue。