# 浅析golang http Client

日常使用golang开发中，经常需要使用HTTP的形式来调用各类服务，它简单便捷，平时我都是直接使用，并没有深入了解其参数的。下面是我在编写HTTP服务检测功能时对HTTP的了解，以及实现DNS缓存的小结。

## http.Client

下面我来讨论一下`http.Client`的主要属性如下：

```go
type Client struct {
    Jar CookieJar
    Timeout time.Duration
    Transport RoundTripper
}
```


### Jar

用于保存Cookie，如果配置此参数，在HTTP响应`Set-Cookie`时，可自动保存，并在下次请求时将符合条件的Cookie写入至请求头中（与浏览器的形为类似）

```go
jar, _ := cookiejar.New(nil)
http.DefaultClient = &http.Client{
	Jar: jar,
}
resp, _ := http.Get("https://www.baidu.com/")
fmt.Println(resp)
fmt.Println(jar)
```

### Timeout

HTTP请求的超时设置，包括了连接时间，重定向以及读取响应的时间，如果不配置，则为无超时处理，默认的Client则是无超时设置。其使用的Transport中的net.Dialer有相应的连接超时，此超时针仅针对连接，如果TCP连接成功，但是请求一直没有响应（死循环卡死等），则请求会一直等待，因此建议在实现使用中设置Client的超时配置，可做如下调整：

```go
http.DefaultClient = &http.Client{
	Timeout: 10 * time.Second,
}
resp, err := http.Get("https://www.baidu.com/")
fmt.Println(err)
fmt.Println(resp)
```


```go
var httpClient = http.Client{
	Timeout: 10 * time.Second,
}

resp, err := httpClient.Get("https://www.baidu.com/")
fmt.Println(err)
fmt.Println(resp)
```

### Transport

HTTP请求中使用的Transport，它处理HTTP的请求复用，各阶段的超时等各类配置，下面我来讲解一些主要的参数配置：


#### TLSHandshakeTimeout

TLS的连接超时配置，Client的超时为整体的处理超时，只参数可只针对TLS的连接设置，如果有需要可单独配置此参数。

#### DisableKeepAlives

是否禁用keepAlives，如果禁用了则每次HTTP请求完成后都会断开请求，除非有特别的应用场景，一般不建议禁用。复用TCP可减少DNS(如果使用域名请求)，TCP(TLS)连接的时间。


```
# 使用keepAlives的两次请求耗时统计，第二次无dnsLookup、tcpConnection以及tlsHandshake的连接处理
{"dnsLookup":2441971260,"tcpConnection":48464488,"tlsHandshake":423072093,"serverProcessing":67391793,"contentTransfer":299615,"total":2982340889}
{"serverProcessing":51478141,"contentTransfer":153230,"total":51669258}
```

```
# 禁用keepAlives的两次请求耗时统计
{"dnsLookup":58099722,"tcpConnection":55128660,"tlsHandshake":429420897,"serverProcessing":73946125,"contentTransfer":200335,"total":617847637}
{"dnsLookup":2384147,"tcpConnection":45481663,"tlsHandshake":204489995,"serverProcessing":34170195,"contentTransfer":177685,"total":286853122}
```

#### DisableCompression

是否禁用压缩，默认为false，启用压缩。当启用时，HTTP请求头会添加`Accept-Encoding: gzip`，并自动根据响应头中是否包含`Content-Encoding: gzip`自动将数据解压。

如果设置为true，则并不会自动在HTTP请求头添加`Accept-Encoding: gzip`，因此响应数据也并不会响应压缩数据（因为正常来说响应数据根据Accept-Encoding来响应合适的encoding）。那么如果我希望能接受响应的数据，但在接收到数据之后并不解压（如无需对数据做处理的场景，转发之类），则可以使用如下的处理：

```go
var client = &http.Client{
	Transport: &http.Transport{
		DisableCompression: true,
	},
}


req, err := http.NewRequest("GET", "/", nil)
if err != nil {
	return
}
req.Header.Set("Accept-Encoding", "gzip")
resp, err := client.Do(req)

if err != nil {
	return
}
defer resp.Body.Close()
buf, err := ioutil.ReadAll(resp.Body)
```


#### MaxIdleConns

最大的空闲连接数(keep-alive)，此配置针对所有的host，默认为无限制（0）。可根据实际应用场景配置此参数，避免生成了过多的空闲连接。

#### MaxIdleConnsPerHost

与MaxIdleConns类似，只不过此限制是针对每个host有效。默认为DefaultMaxIdleConnsPerHost（2），可根据需要调整更大的数值。

#### MaxConnsPerHost

每个host的最大连接数，包括连接中、活动、空闲的所有连接，默认为无限制（0）。

#### IdleConnTimeout

空闲连接的超时时长，设置为0表示无限制，尽量配置此参数以便无用的空闲连接可被关闭，避免浪费连接资源。

#### ResponseHeaderTimeout

连接成功后等待响应的超时时长，设置为0表示无限制。一般而言，在连接成功之后，数据响应之前的时长与服务器接口处理时长相等。我在配置总体超时之后，较少单独配置此参数。

#### MaxResponseHeaderBytes

响应头的最大字节数，默认为`10 << 20 // conservative default; same as http2`。默认10KB的限制已可满足实际使用中的场景，如果接口响应的数据大量的记录在响应头中，超过限制尺寸则可调整更大的限制，但不太建议将大量的响应数据写入至响应头中（因为HTTP的响应头无法做压缩处理，浪费带宽）

#### DialContext

定义如何创建一个非加密的TCP连接


## 定义公共的http.Client

我在使用golang开发时，不建议使用默认的Client，最好根据自己的实际需求定制更符合应用的Client。首先我看看golang中默认的Client，初始化代码如下：

```go
var DefaultClient = &Client{}
```

初始化无指定任何参数，无超时设置，使用默认的transport，下面来看看默认的transport初始化代码：

```go
var DefaultTransport RoundTripper = &Transport{
	Proxy: ProxyFromEnvironment,
	DialContext: (&net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
		DualStack: true,
	}).DialContext,
	MaxIdleConns:          100,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
}
```

下面是我常用的Client参数配置，如下：

```go
&http.Client{
    // 总体的超时设置为10秒，需要注意，如果超时并不代表该处理失败，
    // 只代表该处理在10秒内未完成，处理结果未知
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
	    // 指定dial的超时设置
		DialContext: (&net.Dialer{
    		Timeout:   10 * time.Second,
    		KeepAlive: 30 * time.Second,
    		DualStack: true,
    	}).DialContext,
		MaxIdleConns:           50,
		IdleConnTimeout:        60 * time.Second,
		TLSHandshakeTimeout:    5 * time.Second,
		ExpectContinueTimeout:  1 * time.Second,
		// 限制响应头的大小，避免依赖的服务过多使用响应头
		MaxResponseHeaderBytes: 5 * 1024,
	},
}
```

对于`Proxy`参数我并没有配置，因为都是各内部系统的调用，无需要使用proxy，不配置此参数为了避免服务器上人为避免了proxy env导致所有请求都通过proxy转发。

## 实现自定义DNS解析

我有着各类HTTP的外部服务，平时的检测都是通过使用内部IP的形式来检测，而此方式的检测无法保证外网的访问是否正常，有一次外网访问出现问题而服务检测并未发现异常，因此需要增加外部访问的可用性检测。

我的外部服务最少部署在2个IDC以上，客户端通过域名的形式访问，因此我直接针对外网IP增加服务可用性测试，示例代码如下：

```go
var client = &http.Client{
	Timeout: 10 * time.Second,
}

req, err := http.NewRequest("GET", "http://14.215.177.38/", nil)
req.Host = "www.baidu.com"
if err != nil {
	return
}
resp, err := client.Do(req)
```

我的入口IP针对HTTP请求的host做转发，因此需要指定Host参数才可转发至相应的服务。后续相关的服务都迁移至https，检测也需要指定为https，因为使用IP的形式访问，https证书校验会失败，因此调整为忽略https证书，如下：

```go
var client = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
		},
	},
}

req, err := http.NewRequest("GET", "https://14.215.177.38/", nil)
req.Host = "www.baidu.com"
if err != nil {
	return
}
resp, err := client.Do(req)
```

检测服务正常运行，外部服务也没有出现什么问题，大家都皆大欢喜之际。有一个服务在其中一个IDC的https证书更新有误，而服务检测忽略了相关的证书安全问题，没有及时发现又被批斗了。此时我只能跪求老大原谅，很快会拿出与客户端访问一致的检测服务。

一开始我是再自建了一个DNS的解析，短有效期，轮询切换相应IP解释，但是出问题的时候无法明确IP，因此此方案无法满足我的检测。最终深入研究http.Client的实现，我绕过DNS的解析来实现检测方式，代码如下：

```go
var client = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialer := &net.Dialer{}
			return dialer.DialContext(ctx, network, "14.215.177.38:443")
		},
	},
}

req, err := http.NewRequest("GET", "https://www.baidu.com/", nil)
if err != nil {
	return
}
resp, err := client.Do(req)
```

调整DialContext，将对域名的访问直接调整为对IP的访问，直接绕过了DNS的解析，实现了完整的链路检测。

## 后记

TCP复用是减少了域名解析以及连接的处理，在多次创建TCP请求时，每次还是需要依赖DNS的解析。在我实际使用的统计中，DNS的解析基本需要耗时1ms左右，因此我调整了`DialContext`实现DNS的缓存处理-[dnscache](https://github.com/vicanso/dnscache)。

```go
// DNS解析缓存60秒
ds := dnscache.New(60)
http.DefaultClient.Transport = &http.Transport{
  DialContext: ds.GetDialContext(),
}
resp, err := http.Get("https://www.baidu.com/")
```

注：HTTP各阶段的处理时间统计参考[httpstat](https://github.com/davecheney/httpstat)