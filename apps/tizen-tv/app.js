(function () {
  'use strict';
  var setup = document.getElementById('setup');
  var frame = document.getElementById('calendar');
  var field = document.getElementById('server');
  var status = document.getElementById('status');
  var serverOrigin = '';
  var timer;
  var saved = localStorage.getItem('mantel.server');
  if (saved) field.value = saved;

  function fitCalendar() {
    // Use a readable layout width while filling the TV at either HD or 4K.
    var scale = Math.max(1, window.innerWidth / 1360);
    frame.style.width = (window.innerWidth / scale) + 'px';
    frame.style.height = (window.innerHeight / scale) + 'px';
    frame.style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('resize', fitCalendar);
  fitCalendar();
  function showSetup(message) {
    clearTimeout(timer);
    frame.hidden = true;
    setup.hidden = false;
    status.textContent = message || '';
    field.focus();
  }
  function openCalendar() {
    var raw = field.value.trim();
    if (!raw) { showSetup("Enter your Mantel server address."); return; }
    if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
    try {
      var url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      if (!url.port && url.protocol === 'http:') url.port = '8080';
      serverOrigin = url.origin;
    } catch (_) { showSetup('Enter a valid server address, such as your-server:8080.'); return; }
    localStorage.setItem('mantel.server', serverOrigin);
    status.textContent = 'Connecting to your calendar…';
    // The server keeps API requests same-origin, including pairing and photo URLs.
    frame.src = serverOrigin + '/calendar/week?tv=1';
    timer = setTimeout(function () {
      showSetup('Cannot reach Mantel. Check the server, Wi-Fi, and the desktop firewall, then retry.');
    }, 15000);
  }
  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow || event.origin !== serverOrigin) return;
    if (event.data && event.data.type === 'mantel:ready') {
      clearTimeout(timer);
      setup.hidden = true;
      frame.hidden = false;
      frame.focus();
    }
    if (event.data && event.data.type === 'mantel:back') showSetup();
  });
  document.getElementById('connect-form').addEventListener('submit', function (event) {
    event.preventDefault();
    openCalendar();
  });
  document.getElementById('exit').addEventListener('click', function () {
    if (window.tizen) window.tizen.application.getCurrentApplication().exit();
    else showSetup('Exit is available when running on the Samsung TV.');
  });
  document.addEventListener('keydown', function (event) {
    if (event.keyCode === 10009 || event.key === 'Escape') {
      event.preventDefault();
      if (!frame.hidden) showSetup();
      else document.getElementById('exit').focus();
      return;
    }
    if (!frame.hidden) return;
    var controls = Array.from(setup.querySelectorAll('input, button'));
    var index = controls.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      var next = Math.max(0, Math.min(controls.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      controls[next].focus();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !frame.hidden) openCalendar();
  });
  if (saved) openCalendar();
  else field.focus();
}());
