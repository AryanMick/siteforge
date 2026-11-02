/* Utility pages (search results, my list, sign-in, requests, newsletter confirmation). Each page's <main> carries
   data-sf-page; the handler below fills it from the query string and this browser's saved data. */
window.SiteUtilityPages = {
  search: function (S, holder) {
    var p = new URLSearchParams(location.search);
    var q = (p.get('q') || p.get('s') || p.get('keys') || p.get('query') || '').trim();
    var input = holder.querySelector('input[name=q]');
    if (input) { input.value = q; if (!q) input.focus(); }
    var status = holder.querySelector('.sf-search-status');
    var out = holder.querySelector('.sf-search-results');
    var idx = window.SF_SEARCH_INDEX || { sections: [], pages: [] };
    if (!q) { status.textContent = 'Enter a word or phrase to search ' + idx.pages.length + ' pages on ' + S.site + '.'; return; }
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    var hits = [];
    idx.pages.forEach(function (row) {
      var title = row[0].toLowerCase(), section = (idx.sections[row[2]] || '').toLowerCase(), more = (row[3] || '').toLowerCase(), path = row[1].toLowerCase();
      var score = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var s = (title.indexOf(w) >= 0 ? 5 : 0) + (section.indexOf(w) >= 0 ? 2 : 0) + (more.indexOf(w) >= 0 ? 1 : 0) + (path.indexOf(w) >= 0 ? 1 : 0);
        if (!s) return;
        score += s;
      }
      hits.push([score, row]);
    });
    hits.sort(function (a, b) { return b[0] - a[0] || a[1][0].localeCompare(b[1][0]); });
    var mark = function (s) { var h = S.esc(s); words.forEach(function (w) { h = h.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;') + ')', 'ig'), '<mark>$1</mark>'); }); return h; };
    status.textContent = hits.length ? hits.length + (hits.length === 1 ? ' result' : ' results') + ' for “' + q + '”' : 'No pages match “' + q + '”. Try fewer or different words.';
    out.innerHTML = hits.slice(0, 50).map(function (h) {
      var r = h[1];
      return '<li class="sf-result"><a class="sf-result__title" href="' + S.esc(new URL(r[1], S.root).href) + '">' + mark(r[0]) + '</a><p class="sf-result__meta">' + S.esc(idx.sections[r[2]] || 'Home') + '</p>' + (r[3] ? '<p class="sf-result__text">' + mark(r[3]) + '</p>' : '') + '</li>';
    }).join('');
    if (hits.length > 50) status.textContent += ' (showing the first 50)';
  },

  list: function (S, holder) {
    function render() {
      var list = S.store.get('list', []);
      var requests = S.store.get('requests', []);
      var subs = S.store.get('subscriptions', []);
      var groups = {};
      list.forEach(function (x) { (groups[x.group] = groups[x.group] || []).push(x); });
      var html = '';
      if (!list.length && !requests.length && !subs.length) html = '<p class="sf-empty-state">Your list is empty. Use buttons such as “Place hold”, “Add to list”, “Add to planner” or “Follow” on any page and the items appear here.</p>';
      Object.keys(groups).forEach(function (g) {
        html += '<section class="sf-group"><h2>' + S.esc(g) + ' (' + groups[g].length + ')</h2><ul class="sf-items">' + groups[g].map(function (x) {
          return '<li class="sf-item"><a href="' + S.esc(new URL(x.url.replace(/^\//, ''), S.root).href) + '">' + S.esc(x.title) + '</a> <span class="sf-item__meta">' + S.esc(x.action) + ' · ' + S.esc(x.savedAt.slice(0, 10)) + '</span> <button type="button" class="pg-btn pg-btn-ghost pg-btn-sm" data-remove="' + S.esc(x.key) + '">Remove</button></li>';
        }).join('') + '</ul></section>';
      });
      if (requests.length) html += '<section class="sf-group"><h2>Requests (' + requests.length + ')</h2><ul class="sf-items">' + requests.map(function (r) { return '<li class="sf-item"><strong>' + S.esc(r.type) + '</strong> · ' + S.esc(r.item || '') + ' <span class="sf-item__meta">Reference ' + S.esc(r.ref) + ' · received ' + S.esc(r.at.slice(0, 10)) + '</span></li>'; }).join('') + '</ul></section>';
      if (subs.length) html += '<section class="sf-group"><h2>Email subscriptions</h2><ul class="sf-items">' + subs.map(function (s) { return '<li class="sf-item">' + S.esc(s.list) + ' <span class="sf-item__meta">' + S.esc(s.email) + '</span></li>'; }).join('') + '</ul></section>';
      if (list.length || requests.length || subs.length) html += '<p><button type="button" class="pg-btn pg-btn-secondary" data-clear-list>Clear my list</button></p>';
      holder.querySelector('.sf-list').innerHTML = html;
    }
    holder.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-remove]');
      if (rm) { S.store.set('list', S.store.get('list', []).filter(function (x) { return x.key !== rm.getAttribute('data-remove'); })); render(); S.toast('Removed from your list.'); }
      if (e.target.closest('[data-clear-list]')) { S.store.del('list'); S.store.del('requests'); S.store.del('subscriptions'); render(); S.toast('Your list has been cleared.'); }
    });
    render();
  },

  signin: function (S, holder) {
    var p = new URLSearchParams(location.search);
    var purpose = p.get('for') || '';
    var next = p.get('next') || '';
    var form = holder.querySelector('form');
    var result = holder.querySelector('.sf-signed-in');
    if (purpose) holder.querySelector('.sf-purpose').textContent = 'Sign in to continue: ' + purpose + '.';
    function show(account) {
      form.hidden = !!account; result.hidden = !account;
      if (!account) return;
      var list = S.store.get('list', []), requests = S.store.get('requests', []);
      var holds = list.filter(function (x) { return x.group === 'Holds'; }).length;
      var extra = '';
      if (/renew/i.test(purpose)) extra = '<p>You have no items checked out, so there is nothing to renew. Holds waiting: ' + holds + '.</p>';
      else if (/status/i.test(purpose)) extra = requests.length ? '<p>Your requests:</p><ul>' + requests.map(function (r) { return '<li>' + S.esc(r.type) + ' (' + S.esc(r.ref) + '): received, awaiting review</li>'; }).join('') + '</ul>' : '<p>You have not made any requests yet.</p>';
      else extra = '<p>Saved items: ' + list.length + '. Requests: ' + requests.length + '.</p>';
      result.innerHTML = '<p class="sf-ok" role="status">Signed in as <strong>' + S.esc(account.email) + '</strong>.</p>' + extra
        + '<p>This is a demonstration account on a fictional test site: it lives only in this browser and no password was sent anywhere.</p>'
        + '<p><a href="' + S.esc(S.url('list')) + '">View my list</a>' + (next ? ' · <a href="' + S.esc(new URL(next, location.href).href) + '">Continue to the page you were on</a>' : '') + '</p>'
        + '<p><button type="button" class="pg-btn pg-btn-ghost" data-sign-out>Sign out</button></p>';
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('input[type=email]').value.trim();
      var pass = form.querySelector('input[type=password]').value;
      var err = form.querySelector('.sf-error');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || pass.length < 4) { err.textContent = 'Enter an email address and a password of at least 4 characters.'; err.hidden = false; return; }
      err.hidden = true;
      var account = { email: email, at: new Date().toISOString() };
      S.store.set('account', account); show(account);
    });
    holder.addEventListener('click', function (e) { if (e.target.closest('[data-sign-out]')) { S.store.del('account'); show(null); S.toast('You have signed out.'); } });
    show(S.store.get('account', null));
  },

  request: function (S, holder) {
    var p = new URLSearchParams(location.search);
    var type = p.get('type') || 'Contact us';
    var item = p.get('item') || '';
    var form = holder.querySelector('form');
    holder.querySelector('.sf-request-title').textContent = type;
    holder.querySelector('.sf-request-item').textContent = item ? 'About: ' + item : '';
    form.querySelector('[name=type]').value = type;
    form.querySelector('[name=item]').value = item;
    form.querySelector('[name=from]').value = p.get('from') || '';
    var dated = /book|reserve|visit|appointment|ticket|schedule|register|tour|room|waitlist/i.test(type);
    form.querySelector('.sf-when').hidden = !dated;
    var money = /donat|give|fundraise|pay a bill|buy back issue/i.test(type);
    form.querySelector('.sf-amount').hidden = !money;
    if (p.get('amount')) form.querySelector('[name=amount]').value = p.get('amount');
    function confirm(r) {
      form.hidden = true;
      var done = holder.querySelector('.sf-request-done');
      done.hidden = false;
      done.innerHTML = '<h2>Request received</h2><p class="sf-ok" role="status">Thank you, ' + S.esc(r.name) + '. Your request “' + S.esc(r.type) + '”' + (r.item ? ' about “' + S.esc(r.item) + '”' : '') + ' has been recorded with reference <strong class="sf-ref">' + S.esc(r.ref) + '</strong>.</p>'
        + '<p>We will reply to ' + S.esc(r.email) + (r.when ? ' to confirm ' + S.esc(r.when) : '') + '. ' + (r.amount ? 'Pledged amount: $' + S.esc(r.amount) + ' (no payment was taken). ' : '') + 'This is a fictional test site: the request is kept only in this browser.</p>'
        + '<p><a href="' + S.esc(S.url('list')) + '">View your requests</a>' + (r.from ? ' · <a href="' + S.esc(new URL(r.from, location.href).href) + '">Back to the page you were on</a>' : '') + '</p>';
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = String(v).trim(); });
      var err = form.querySelector('.sf-error');
      if (!data.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '')) { err.textContent = 'Enter your name and a valid email address.'; err.hidden = false; return; }
      err.hidden = true;
      var r = { type: data.type, item: data.item, from: data.from, name: data.name, email: data.email, when: data.when || '', amount: money ? data.amount : '', message: data.message || '', at: new Date().toISOString() };
      r.ref = 'R-' + S.hash(r.type + r.item + r.email + r.at).slice(0, 6);
      var all = S.store.get('requests', []); all.push(r); S.store.set('requests', all);
      confirm(r);
    });
  },

  subscribe: function (S, holder) {
    var p = new URLSearchParams(location.search);
    var email = (p.get('email') || '').trim();
    var list = p.get('list') || S.site + ' newsletter';
    var form = holder.querySelector('form');
    var done = holder.querySelector('.sf-subscribed');
    function confirm(address) {
      var subs = S.store.get('subscriptions', []);
      if (!subs.some(function (s) { return s.email === address && s.list === list; })) { subs.push({ email: address, list: list, at: new Date().toISOString() }); S.store.set('subscriptions', subs); }
      form.hidden = true; done.hidden = false;
      done.innerHTML = '<h2>Thanks for subscribing</h2><p class="sf-ok" role="status"><strong>' + S.esc(address) + '</strong> is now subscribed to “' + S.esc(list) + '”.</p><p>This is a fictional test site, so no email will be sent. The subscription is kept only in this browser.</p><p><a href="' + S.esc(S.url('list')) + '">View my subscriptions</a>' + (p.get('from') ? ' · <a href="' + S.esc(new URL(p.get('from'), location.href).href) + '">Back to the page you were on</a>' : '') + '</p>';
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { confirm(email); return; }
    form.addEventListener('submit', function (e) {
      e.preventDefault(); e.stopPropagation();
      var v = form.querySelector('input[type=email]').value.trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) confirm(v); else S.toast('Enter a valid email address to subscribe.');
    });
  },
};
