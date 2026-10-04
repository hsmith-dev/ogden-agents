/*
 * The page's boot script: a same-origin classic script in <head>, run before
 * the app renders (no inline script, so the Content-Security-Policy allows
 * only the app's own files; AD-15). It does two things:
 *
 * 1. Applies the saved appearance before first paint, so there is no flash of
 *    the wrong theme or density. Developer mode here is only this browser's
 *    copy of the server's setting (permission modes), used until the app
 *    has read the server's.
 * 2. Connects this tab. The launcher opens `/#c=<launch code>`; this strips
 *    the fragment from the address bar at once (history.replaceState) and
 *    sends the single-use code in a same-origin POST. The response body
 *    carries the tab's token, which goes to sessionStorage (this origin and
 *    port only, this tab only). The token never appears in any URL, so it is
 *    never in history, a bookmark or autocomplete. The app waits for the
 *    exchange through `window.__ogdenTabExchange` (a promise of the token, or
 *    null), which also carries the token when storage is blocked.
 *
 * The __…__ names are replaced at build (vite.config.ts) with the constants in
 * packages/shared, so the app and this script agree on them.
 */
(function () {
  var root = document.documentElement;
  try {
    var saved = JSON.parse(localStorage.getItem(__APPEARANCE_STORAGE_KEY__) || '{}');
    if (saved.theme === 'light' || saved.theme === 'dark') root.setAttribute('data-theme', saved.theme);
    if (saved.density === 'compact') root.setAttribute('data-density', 'compact');
    if (saved.developerMode === true) root.setAttribute('data-developer', 'true');
  } catch (e) {
    // No saved appearance: follow the system theme, Comfortable density.
  }

  var prefix = '#' + __LAUNCH_CODE_FRAGMENT_PARAM__ + '=';
  var hash = window.location.hash;
  if (hash.indexOf(prefix) !== 0) return;
  var code = hash.slice(prefix.length);
  var here = window.location.pathname + window.location.search;
  // Strip it first, whatever happens next: a code never stays in the URL.
  var stripped = true;
  try {
    history.replaceState(history.state, '', here);
  } catch (e) {
    stripped = false;
  }

  var pattern = /^[A-Za-z0-9_-]{43}$/;
  var exchange = !pattern.test(code)
    ? Promise.resolve(null)
    : fetch(__TAB_EXCHANGE_PATH__, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code }),
        credentials: 'omit',
        cache: 'no-store',
      })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (body) {
          var token = body && body.token;
          if (typeof token !== 'string' || !pattern.test(token)) return null;
          try {
            sessionStorage.setItem(__TAB_TOKEN_STORAGE_KEY__, token);
          } catch (e) {
            // Storage blocked: the app takes it from the promise, in memory only.
          }
          return token;
        })
        .catch(function () {
          return null;
        });

  if (!stripped) {
    // No history API: reload without the fragment once the token is stored.
    // location.replace, not location.hash, so no history entry keeps the code.
    exchange.then(function () {
      window.location.replace(here);
    });
  }
  Object.defineProperty(window, '__ogdenTabExchange', { value: exchange, configurable: true });
})();
