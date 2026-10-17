// Makes the web app's Print and file-download buttons work inside the
// mobile app, where WebViews ignore window.print() and blob: downloads.
// Injected by the native shell (Android MainActivity, iOS MainViewController).
(function () {
  if (window.__mvmShim) return;
  window.__mvmShim = true;

  function send(msg) {
    if (window.MVMNative) {
      if (msg.type === 'print') window.MVMNative.print();
      else window.MVMNative.saveFile(msg.name, msg.mime, msg.base64);
    } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mvm) {
      window.webkit.messageHandlers.mvm.postMessage(msg);
    }
  }

  window.print = function () { send({ type: 'print' }); };

  // The app revokes blob URLs right after clicking the link, so keep the blob.
  var blobs = {};
  var create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    var url = create.call(URL, obj);
    if (obj instanceof Blob) blobs[url] = obj;
    return url;
  };
  URL.revokeObjectURL = function (url) {
    setTimeout(function () { delete blobs[url]; revoke.call(URL, url); }, 60000);
  };

  function save(a) {
    var blob = blobs[a.href];
    if (!blob) return false;
    var reader = new FileReader();
    reader.onload = function () {
      var data = String(reader.result);
      send({ type: 'save', name: a.download || 'download', mime: blob.type || 'application/octet-stream', base64: data.slice(data.indexOf(',') + 1) });
    };
    reader.readAsDataURL(blob);
    return true;
  }

  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && this.href.indexOf('blob:') === 0 && save(this)) return;
    return click.call(this);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a && a.href.indexOf('blob:') === 0 && save(a)) e.preventDefault();
  }, true);
})();
