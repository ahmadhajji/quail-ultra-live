(function bootstrapCompat(window) {
  const listeners = {}

  function emit(channel) {
    const args = Array.prototype.slice.call(arguments, 1)
    const handlers = listeners[channel] || []
    handlers.forEach(function callHandler(handler) {
      handler.apply(null, [{}].concat(args))
    })
  }

  const ipcRenderer = {
    on: function on(channel, handler) {
      if (!listeners[channel]) {
        listeners[channel] = []
      }
      listeners[channel].push(handler)
    },
    send: function send(channel, payload) {
      Promise.resolve(window.QuailLive.handleIpcSend(channel, payload)).catch(function handleError(error) {
        window.alert(error.message || 'The requested action failed.')
      })
    },
    _emit: emit
  }

  function Store(options) {
    options = options || {}
    this.namespace = options.name || ''
  }

  Store.initRenderer = function initRenderer() {}

  Store.prototype.makeKey = function makeKey(key) {
    const namespace = this.namespace ? `${this.namespace}:` : ''
    return `${window.QuailLive.STORE_PREFIX}${namespace}${key}`
  }

  Store.prototype.has = function has(key) {
    return window.localStorage.getItem(this.makeKey(key)) !== null
  }

  Store.prototype.get = function get(key) {
    const raw = window.localStorage.getItem(this.makeKey(key))
    if (raw === null) {
      return undefined
    }
    try {
      return JSON.parse(raw)
    } catch (error) {
      return raw
    }
  }

  Store.prototype.set = function set(key, value) {
    window.localStorage.setItem(this.makeKey(key), JSON.stringify(value))
  }

  Store.prototype.delete = function remove(key) {
    window.localStorage.removeItem(this.makeKey(key))
  }

  function pathToFileURL(value) {
    return {
      toString: function toString() {
        return value
      }
    }
  }

  window.require = function require(moduleName) {
    switch (moduleName) {
      case 'jquery':
        return window.jQuery
      case 'bootstrap':
        return {}
      case 'popper.js':
        return window.Popper || {}
      case 'electron':
        return { ipcRenderer: ipcRenderer }
      case 'electron-store':
        return Store
      case 'url':
        return { pathToFileURL: pathToFileURL }
      default:
        throw new Error(`Unsupported browser require("${moduleName}")`)
    }
  }

  document.addEventListener('DOMContentLoaded', function onDomReady() {
    window.QuailLive.initPageBridge(ipcRenderer)
  })
})(window)
