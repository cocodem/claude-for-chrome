const cfcBase =
  "https://cfc.aroic.workers.dev/" || "http://localhost:8787/" || ""

export function isMatch(u, includes) {
  if (typeof u == "string") {
    u = new URL(u, location?.origin)
  }
  return includes.some((v) => {
    if (u.host == v) return !0
    if (u.href.startsWith(v)) return !0
    if (u.pathname.startsWith(v)) return !0
    if (v[0] == "*" && (u.host + u.pathname).indexOf(v.slice(1)) != -1)
      return !0
    return !1
  })
}

async function clearApiKeyLogin() {
  const { accessToken } = await chrome.storage.local.get({ accessToken: "" })
  const payload = JSON.parse(
    (accessToken && atob(accessToken.split(".")[1] || "")) || "{}"
  )
  if (payload && payload.iss == "auth") {
    await chrome.storage.local.set({
      accessToken: "",
      refreshToken: "",
      tokenExpiry: 0,
    })
    await getOptions(!0)
  }
}

if (!globalThis.__cfc_options) {
  globalThis.__cfc_options = {
    mode: "",
    cfcBase: cfcBase,
    anthropicBaseUrl: "",
    apiBaseIncludes: ["https://api.anthropic.com/v1/"],
    proxyIncludes: [
      "cdn.segment.com",
      "featureassets.org",
      "assetsconfigcdn.org",
      "featuregates.org",
      "api.segment.io",
      "prodregistryv2.org",
      "beyondwickedmapping.org",
      "api.honeycomb.io",
      "statsigapi.net",
      "events.statsigapi.net",
      "api.statsigcdn.com",
      "https://api.anthropic.com/api/oauth/profile",
      "https://console.anthropic.com/v1/oauth/token",
      "/api/web/domain_info/browser_extension",
    ],
    discardIncludes: [
      "cdn.segment.com",
      "api.segment.io",
      "events.statsigapi.net",
      "api.honeycomb.io",
      "prodregistryv2.org",
    ],
    modelAlias: {},
  }
}

let _optionsPromise = null
let _updateAt = 0

export async function getOptions(force = false) {
  const fetch = globalThis.__fetch
  const options = globalThis.__cfc_options
  const baseUrl = options.cfcBase || cfcBase

  if (!_optionsPromise && (force || Date.now() - _updateAt > 1000 * 3600)) {
    _optionsPromise = new Promise(async (resolve) => {
      setTimeout(resolve, 1000 * 2.8)
      try {
        const res = await fetch(baseUrl + "api/options")
        const {
          mode,
          cfcBase,
          anthropicBaseUrl,
          apiBaseIncludes,
          proxyIncludes,
          discardIncludes,
          modelAlias,
        } = await res.json()
        options.mode = mode
        options.cfcBase = cfcBase || options.cfcBase
        options.anthropicBaseUrl = anthropicBaseUrl || options.anthropicBaseUrl
        options.apiBaseIncludes = apiBaseIncludes || options.apiBaseIncludes
        options.proxyIncludes = proxyIncludes || options.proxyIncludes
        options.discardIncludes = discardIncludes || options.discardIncludes
        options.modelAlias = modelAlias || options.modelAlias
        _updateAt = Date.now()

        if (mode == "claude") {
          await clearApiKeyLogin()
        }
      } finally {
        resolve()
        _optionsPromise = null
      }
    })
  }

  if (_optionsPromise) {
    await _optionsPromise
  }

  return options
}

if (!globalThis.__fetch) {
  globalThis.__fetch = fetch
}

export async function request(input, init) {
  const fetch = globalThis.__fetch
  const u = new URL(input, location?.origin)
  const {
    proxyIncludes,
    mode,
    cfcBase,
    anthropicBaseUrl,
    apiBaseIncludes,
    discardIncludes,
    modelAlias,
  } = await getOptions()

  try {
    if (
      u.href.startsWith("https://console.anthropic.com/v1/oauth/token") &&
      typeof init?.body == "string"
    ) {
      const p = new URLSearchParams(init.body)
      const code = p.get("code")
      if (code && !code.startsWith("cfc-")) {
        return fetch(input, init)
      }
    }
  } catch (e) {
    console.log(e)
  }
  if (mode != "claude" && isMatch(u, apiBaseIncludes)) {
    const apiBase =
      globalThis.localStorage?.getItem("apiBaseUrl") ||
      anthropicBaseUrl ||
      u.origin
    const url = apiBase + u.pathname + u.search
    try {
      if (init?.method == "POST" && typeof init.body == "string") {
        const body = JSON.parse(init.body)
        const { model } = body
        if (model && modelAlias[model]) {
          body.model = modelAlias[model]
          init.body = JSON.stringify(body)
        }
      }
    } catch (e) {}
    return fetch(url, init)
  }
  if (isMatch(u, discardIncludes)) {
    return new Response(null, { status: 204 })
  }
  if (isMatch(u, proxyIncludes)) {
    const url = cfcBase + u.href
    return fetch(url, init)
  }
  return fetch(input, init)
}

globalThis.fetch = request

if (globalThis.XMLHttpRequest) {
  if (!globalThis.__xhrOpen) {
    globalThis.__xhrOpen = XMLHttpRequest?.prototype?.open
  }
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    const originalOpen = globalThis.__xhrOpen
    const { cfcBase, proxyIncludes } = globalThis.__cfc_options
    let finalUrl = url

    if (isMatch(url, proxyIncludes)) {
      finalUrl = cfcBase + url
    }
    originalOpen.call(this, method, finalUrl, ...args)
  }
}

if (!globalThis.__createTab) {
  globalThis.__createTab = chrome?.tabs?.create
}
chrome.tabs.create = async function (...args) {
  const url = args[0]?.url
  if (url && url.startsWith("https://claude.ai/oauth/authorize")) {
    const { cfcBase, mode } = await getOptions()
    const m = chrome.runtime.getManifest()
    if (mode !== "claude") {
      args[0].url =
        url
          .replace("https://claude.ai/", cfcBase)
          .replace("fcoeoabgfenejglbffodgkkbkcdhcgfn", chrome.runtime.id) +
        `&v=${m.version}`
    }
  }
  return __createTab.apply(chrome.tabs, args)
}

chrome.runtime.onMessageExternal.addListener(async (msg) => {
  if (msg.type == "_claude_account_mode") {
    await clearApiKeyLogin()
  }
  if (msg.type == "_api_key_mode") {
    await getOptions(true)
  }
  if (msg.type == "_set_storage_local") {
    await chrome.storage.local.set(msg.data)
  }
  if (msg.type == "_open_options") {
    await chrome.runtime.openOptionsPage()
  }
})

if (globalThis.window) {
  if (location.pathname == "/sidepanel.html" && location.search == "") {
    chrome.tabs.query({ active: !0, currentWindow: !0 }).then(([tab]) => {
      const u = new URL(location.href)
      u.searchParams.set("tabId", tab.id)
      history.replaceState(null, "", u.href)
    })
  }
  if (location.pathname == "/arc.html") {
    const fetch = globalThis.__fetch
    fetch(cfcBase + "api/arc-split-view")
      .then((res) => {
        return res.json()
      })
      .then((data) => {
        document.querySelector(".animate-spin").outerHTML = data.html
      })

    fetch("/options.html")
      .then((res) => res.text())
      .then((html) => {
        const matches = html.match(/[^"\s]+?\.css/g)
        for (const url of matches) {
          const link = document.createElement("link")
          link.rel = "stylesheet"
          link.href = url
          document.head.appendChild(link)
        }
      })

    window.addEventListener("resize", async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const tab = await new Promise((resolve) => {
        tabs.forEach(async (t) => {
          if (t.url.startsWith(location.origin)) return
          const [value] = await chrome.scripting.executeScript({
            target: { tabId: t.id },
            func: () => {
              return document.visibilityState
            },
          })
          if (value.result == "visible") {
            resolve(t)
          }
        })
      })
      if (tab) {
        location.href = "/sidepanel.html?tabId=" + tab.id
        chrome.tabs.update(tab.id, { active: true })
      }
    })

    chrome.system.display.getInfo().then(([info]) => {
      location.hash = "id=" + info?.id
      console.log(info)
    })
  }
}

if (!globalThis.__openSidePanel) {
  globalThis.__openSidePanel = chrome?.sidePanel?.open
}
const isChrome = navigator.userAgentData?.brands?.some(
  (b) => b.brand == "Google Chrome"
)
if (!isChrome && chrome.sidePanel) {
  chrome.sidePanel.open = async (...args) => {
    const open = globalThis.__openSidePanel
    const result = await open.apply(chrome.sidePanel, args)
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["SIDE_PANEL"],
    })
    const success = contexts.length > 0
    if (!success) {
      chrome.tabs.create({ url: "/arc.html" })
    }
    return result
  }
}
