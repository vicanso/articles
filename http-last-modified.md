如何优化HTTP的性能，已经有很多的文章介绍`Cache-Control`, `ETag`等等的使用，本文主要是介绍`Last-Modified`，不是介绍其对性能的优化，而是很多人都忽略了它的副作用。

## Last-Modified 304

在讲这篇文章之前，首先介绍一下`Last-Modified`的作用，下面取自MDN中的HTTP介绍：

```
The Last-Modified response HTTP header contains the date and time at which 
the origin server believes the resource was last modified. It is used as a 
validator to determine if a resource received or stored is the same. Less 
accurate than an ETag header, it is a fallback mechanism. Conditional 
requests containing If-Modified-Since or If-Unmodified-Since headers 
make use of this field.
```

大家都了解设置`Last-Modified`可以达到`304`（协商缓存），提升响应速度，而且主要是用于一些静态文件的处理（nginx等简单快捷的配置处理静态文件）。

## 副作用 

在享受性能上提升的同时，你是否了解它有可能导致直接从缓存中读取，而不需要与服务器协商呢？

下面先来进行测试：

- 第一次加载a.html，服务器返回200（有Last-Modified字段，时间设置为1个小时前）
- 第二次加载a.html，请求头带上(If-Modified-Since)，服务器判断该数据没有更新，返回304
- 尝试刷新、输入地址方式来重新获取a.html，请求头带上(If-Modified-Since)，服务器判断该数据没有更新，返回304

上面做的三个测试都证明使用了`Last-Modified`之后，有可能是`304`（协商缓存），但是每次还是需要后端来判断缓存是否可用，下面继续来一个测试：

- 增加b.html，添加跳转至a.html的链接，调整a.html，增加跳转到b.html的链接
- 首次加载b.html，服务器返回200（有Last-Modified字段，时间设置为1个小时前）
- 点击b.html上面的链接，跳转至a.html，这个时候问题出现了，查看后端日志，并没有任何的请求，但是浏览器已接收到数据，而且状态码是`200`（并不是from cache）
- 再从a.html点击链接跳转到b.html时，也是同样的情况（浏览器中链接跳转到输入url打开并不是同样的处理）

HTTP响应直接从缓存中读取使用，并没有与服务端协商，这是什么原因呢，那么还能直接使用`Last-Modified`吗？

在`w3.org`中协议相关的文档中，有一段是[Heuristic Expiration](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)，内容如下：

```
Since origin servers do not always provide explicit expiration times, HTTP 
caches typically assign heuristic expiration times, employing algorithms 
that use other header values (such as the Last-Modified time) to estimate 
a plausible expiration time. The HTTP/1.1 specification does not provide 
specific algorithms, but does impose worst-case constraints on their results. 
Since heuristic expiration times might compromise semantic transparency, 
they ought to used cautiously, and we encourage origin servers to provide 
explicit expiration times as much as possible.
```

从上面这段话看得出，由于服务器端没有指定确切的过期时间，HTTP的缓存通常会推测缓存的过期时间，通过其它的标准HTTP头（如Last-Modified）来估计一个合理的到期时间，而且这个算法还没有一个确切的标准实现。

上面的测试中从`b.html`跳转至`a.html`时，服务器并没有收到该请求，是因为浏览器根据`Last-Modified`中估计认为缓存的响应数据可用，直接从缓存中读取了。

## 小结

前端项目构建，现在静态文件的加载已经都使用了hash版本号，因此每次更新都会有新的版本号，`Last-Modified`并不会导致任何的副作用，但是单页面的盛行，前端生成出静态的html，客户端通过`webview`，`wechat`等方式加载的时候，`Last-Modified`的副作用就出来了，客户无法做刷新，服务器也无法做调整，最终还需要让客户手工去清除缓存。因此在设置HTTP响应头的时候，需要注意以下两点：

- 设置`Cache-Control`或`Expires`头，指定缓存时间
- 对于静态文件，如果不是根据内容生成版本号（如html），请注意区别对待
