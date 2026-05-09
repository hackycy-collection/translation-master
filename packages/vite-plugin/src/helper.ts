/**
 * @description: 获取全局translate对象
 * @link https://github.com/xnx3/translate
 */
export function getTranslate(): Record<string, any> | undefined {
  if (!(window as any).translate) {
    return
  }

  return (window as any).translate
}

export function executeTranslate(): void {
  return getTranslate()?.execute()
}

export function initializeTranslate(listener?: boolean): void {
  if (!getTranslate()) {
    return
  }

  // 不出现的select的选择语言
  getTranslate()!.selectLanguageTag.show = false
  // 设置机器翻译服务通道
  getTranslate()!.service.use('client.edge')
  if (listener) {
    // 开启html页面变化的监控
    getTranslate()!.listener.start()
  }
}
