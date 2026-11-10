// Deliberately ES5: still displays a useful error if the main app cannot parse/start.
(function () {
  var started = false;
  function fail(message) {
    document.getElementById('status').textContent = 'Unable to start';
    document.getElementById('hint').textContent = message;
    document.getElementById('detail').textContent = message;
    document.getElementById('reload').hidden = false;
  }
  window.addEventListener('ghostpad-started', function () { started = true; });
  window.addEventListener('error', function () {
    if (!started) fail('Ghostpad could not start in this browser. Reload in Chrome on Android or Safari on iPhone; update the browser if this persists.');
  });
  setTimeout(function () {
    if (!started) fail('The page arrived, but Ghostpad did not start. Reload in Chrome on Android or Safari on iPhone.');
  }, 6000);
  document.getElementById('reload').onclick = function () { window.location.reload(); };
})();
