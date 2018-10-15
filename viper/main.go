package main

import (
	"bytes"
	"fmt"
	"os"

	"github.com/gobuffalo/packr"
	"github.com/spf13/viper"
)

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

func main() {
	err := initConfig()
	if err != nil {
		panic(err)
	}
	fmt.Println(viper.GetString("db.uri"))
	fmt.Println(viper.GetString("db.poolSize"))
}
