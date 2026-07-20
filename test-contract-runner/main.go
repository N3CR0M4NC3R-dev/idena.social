package main

import (
	"github.com/idena-network/idena-go/config"
	"github.com/idena-network/idena-go/log"
	"github.com/urfave/cli/v2"
	"os"
	"runtime"
)

var (
	version = "0.0.1"
)

func main() {
	app := cli.NewApp()
	app.Version = version

	app.Flags = []cli.Flag{}

	app.Action = func(context *cli.Context) error {
		logLvl := log.LvlInfo

		useLogColor := true
		if runtime.GOOS == "windows" {
			useLogColor = context.Bool(config.LogColoring.Name)
		}

		handler := log.LvlFilterHandler(logLvl, log.StreamHandler(os.Stdout, log.TerminalFormat(useLogColor)))

		log.Root().SetHandler(handler)

		log.Info("Idena contract runner is starting", "version", app.Version)

		runner := NewRunner()
		if err := runner.Start(); err != nil {
			return err
		}
		runner.LogBalance()
		runner.WaitForStop()
		return nil
	}

	err := app.Run(os.Args)
	if err != nil {
		log.Error(err.Error())
	}
}
