# 巧用viper实现多环境配置

应用系统的配置信息，一般分为两种，一是经常变化的配置则保存到数据库，另外一种则是不常变化的则以配置文件的形式保存。一般而言，应用系统至少有三组运行环境：开发环境、测试环境、生产环境，本文主要探讨在`golang`项目中如何使用viper实现多环境应用配置。如果对viper不了解的可以先去阅读一下官方说明[https://github.com/spf13/viper](https://github.com/spf13/viper)。


## 青铜时代 

一开始的时候，我针对每个环境配置各自的yaml，在启动的时候根据环境变量读取相应的配置文件，处理代码如下：


```go
func initConfig() (err error) {
	env := os.Getenv("GO_ENV")
	viper.SetConfigName(env)
	viper.AddConfigPath("./configs")
	viper.SetConfigType("yml")
	err = viper.ReadInConfig()
	return
}

func main() {
	err := initConfig()
	if err != nil {
		panic(err)
	}
	fmt.Println(viper.GetString("db.uri"))
	fmt.Println(viper.GetString("db.poolSize"))
}
```

不同环境的配置文件如下：

```yml
# test
app: viper-test
db:
  uri: postgres://tree:mypwd@127.0.0.1:5432/viper-test?connect_timeout=5&sslmode=disable
  poolSize: 100
```

```yml
# production
app: viper-test
db:
  uri: postgres://tree:mypwd@10.1.1.1:5432/viper?connect_timeout=5&sslmode=disable
  poolSize: 100
```

由上面的代码可以看出，因为viper读取的配置只有一份，因此需要在每个配置中将所有的配置都一一填写，而不同环境的配置绝大部分都是相同的，只有小部分是不一致。一开始只有不到10个配置项的时候还好维护，后面配置信息越来越多，几十个的时候就是一个深坑了，看到眼都花了，太难管理。

## 白银时代

各运行环境中的配置90%左右是相同，而剩下的10%才是各环境的差异配置，是否可以将相同的配置以默认值的形式保存，而各环境与默认值不相同的再覆盖呢？查看了一下文档，发现了`viper.SetDefault`的函数，一开始是直接在代码一行行的把默认配置写上，但是这样无法利用yaml的便利，在研究了相关的代码之后，最后调整为如下的处理形式，代码如下：

```go
func initConfig() (err error) {
	configType := "yml"
	defaultPath := "./configs"
	v := viper.New()
	// 从default中读取默认的配置
	v.SetConfigName("default")
	v.AddConfigPath(defaultPath)
	v.SetConfigType(configType)
	err = v.ReadInConfig()
	if err != nil {
		return
	}

	configs := v.AllSettings()
	// 将default中的配置全部以默认配置写入
	for k, v := range configs {
		viper.SetDefault(k, v)
	}
	env := os.Getenv("GO_ENV")
	// 根据配置的env读取相应的配置信息
	if env != "" {
		viper.SetConfigName(env)
		viper.AddConfigPath(defaultPath)
		viper.SetConfigType(configType)
		err = viper.ReadInConfig()
		if err != nil {
			return
		}
	}
	return
}
```

此函数将`default.yml`的所有配置读取至一个新的viper实例中，再以`SetDefault`将所有配置写入为默认配置，而各环境配置文件只需要配置差异部分，配置如下：

```yml
# default
app: viper-test
db:
  uri: postgres://tree:mypwd@127.0.0.1:5432/viper-test?connect_timeout=5&sslmode=disable
  poolSize: 100
```

```yml
# test与default完全一致，为空文件
```

```yml
# production只是数据库连接串不一致，只需要配置此项
db:
  uri: postgres://tree:mypwd@10.1.1.1:5432/viper?connect_timeout=5&sslmode=disable
```

通过此调整，不再需要重复的维护相同的配置项，而且也能直观的看出各运行环境的配置差异，减少配置信息的出错概率。

## 王者时代

因为主要是后端程序应用，程序交付一般都是通过docker镜像的形式，配置文件与编译后的应用程序一起打包至镜像中，在多个项目中也使用得挺顺畅。最近有一个项目非运行在docker环境下，因此希望能将配置文件一起打包至应用程序的方式，在了解了几个相关的项目，最终选择了使用[packr](https://github.com/gobuffalo/packr)来将配置文件打包，调整之后的代码如下：


```go
func initConfig() (err error) {
	box := packr.NewBox("./configs")
	configType := "yml"
	defaultConfig := box.Bytes("default.yml")
	v := viper.New()
	v.SetConfigType(configType)
	err = v.ReadConfig(bytes.NewReader(defaultConfig))
	if err != nil {
		return
	}

	configs := v.AllSettings()
	// 将default中的配置全部以默认配置写入
	for k, v := range configs {
		viper.SetDefault(k, v)
	}
	env := os.Getenv("GO_ENV")
	// 根据配置的env读取相应的配置信息
	if env != "" {
		envConfig := box.Bytes(env + ".yml")

		viper.SetConfigType(configType)
		err = viper.ReadConfig(bytes.NewReader(envConfig))
		if err != nil {
			return
		}
	}
	return
}
```

调整之后，配置文件也编译至程序中，后续可以单执行文件交付，只通过在启动时指定`GO_ENV`则可。