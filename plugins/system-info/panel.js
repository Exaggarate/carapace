// System Info panel (#66944 example plugin): reads the same-origin bearer token the
// dashboard stores in localStorage, then polls /health + /api/v1/status and renders
// plain text via textContent. Zero dependencies.
(function () {
  "use strict";
  var TOKEN_KEY = "carapace.dashboard.token";

  function token() {
    try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch (err) { return ""; }
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }
  function rowKV(key, value) {
    var row = el("div", "kvline");
    row.appendChild(el("span", "k", key));
    row.appendChild(el("span", null, value));
    return row;
  }
  function fmtUptime(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h) { return h + "h " + (m % 60) + "m"; }
    if (m) { return m + "m " + Math.floor(sec % 60) + "s"; }
    return sec + "s";
  }

  function fetchJson(path) {
    var headers = {};
    var saved = token();
    if (saved) { headers["Authorization"] = "Bearer " + saved; }
    return window.fetch(path, { headers: headers }).then(function (res) {
      return res.text().then(function (body) {
        if (!res.ok) { throw new Error(res.status + " " + body); }
        return body ? JSON.parse(body) : {};
      });
    });
  }

  function render() {
    var root = document.getElementById("root");
    fetchJson("/health")
      .then(function (health) { return fetchJson("/api/v1/status").then(function (status) { return [health, status]; }); })
      .then(function (loaded) {
        var health = loaded[0]; var status = loaded[1];
        root.textContent = "";
        var kv = el("div", "kv");
        kv.appendChild(rowKV("carapace", "v" + health.version + " (" + health.service + ")"));
        kv.appendChild(rowKV("node", health.node));
        kv.appendChild(rowKV("uptime", fmtUptime(status.uptimeSec)));
        kv.appendChild(rowKV("model", status.model + " @ " + status.llmBaseURL));
        kv.appendChild(rowKV("storage", status.storage.path));
        kv.appendChild(rowKV("messages", status.storage.sessions + " sessions, " + status.storage.messages + " messages"));
        root.appendChild(kv);
        var chips = el("div");
        (status.channels || []).forEach(function (channel) {
          chips.appendChild(el("span", "chip" + (channel.configured ? " ok" : ""), channel.name + (channel.configured ? " \u2713" : " off")));
        });
        root.appendChild(chips);
      })
      .catch(function (err) {
        root.textContent = "";
        root.appendChild(el("div", "error", String(err.message || err)));
        root.appendChild(el("p", "note", "If the gateway requires a bearer token, open the dashboard once and save it there — panels reuse the same stored token."));
      });
  }

  render();
  window.setInterval(render, 10000);
})();