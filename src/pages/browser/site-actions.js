/* Site actions: what the buttons, forms and toggles on this site do. Everything runs in the visitor's browser and is
   kept in this browser's localStorage; nothing is sent to a server. Loaded by every page and every utility page. */
(function () {
  'use strict';
  if (window.SiteActions) return;
  var CFG = window.SF_SITE || {};
  var script = document.currentScript;
  var ROOT = script && script.src ? script.src.replace(/assets\/site-actions\.js(?:[?#].*)?$/, '') : location.origin + '/';
  var U = CFG.pages || { search: 'site-search.html', list: 'my-list.html', signin: 'sign-in.html', request: 'request.html', subscribe: 'subscribe.html' };
  var SITE = CFG.name || (document.querySelector('meta[property="og:site_name"]') || {}).content || document.title;
  function url(name, params) {
    var u = new URL(U[name] || name, ROOT);
    Object.keys(params || {}).forEach(function (k) { if (params[k] !== undefined && params[k] !== '') u.searchParams.set(k, params[k]); });
    return u.href;
  }
  function go(href) { location.assign(href); }

  // ------------------------------------------------------------------ storage and small UI helpers
  var store = {
    get: function (key, fallback) { try { var v = localStorage.getItem('sf:' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set: function (key, value) { try { localStorage.setItem('sf:' + key, JSON.stringify(value)); } catch (e) { /* storage blocked */ } },
    del: function (key) { try { localStorage.removeItem('sf:' + key); } catch (e) { /* storage blocked */ } },
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function text(el) { return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function labelOf(el) { return (el.getAttribute('data-sf-label') || el.getAttribute('aria-label') || text(el)).replace(/[×✓▾]/g, '').trim(); }
  function main() { return document.querySelector('main') || document.body; }
  function pageTitle() { var h = main().querySelector('h1'); return h ? text(h) : document.title; }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page'; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).toUpperCase(); }
  function here() { return location.pathname + location.search; }

  var live;
  function toast(message, linkText, linkHref) {
    if (!live) {
      live = document.createElement('div');
      live.className = 'sf-toast';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    live.innerHTML = '<span>' + esc(message) + '</span>' + (linkText ? ' <a href="' + esc(linkHref) + '">' + esc(linkText) + '</a>' : '') + '<button type="button" class="sf-toast__close" aria-label="Dismiss message">×</button>';
    live.hidden = false;
    clearTimeout(live._t);
    live._t = setTimeout(function () { live.hidden = true; }, 8000);
  }
  function dialog(title, html) {
    var old = document.querySelector('.sf-dialog');
    if (old) old.remove();
    var box = document.createElement('div');
    box.className = 'sf-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.innerHTML = '<div class="sf-dialog__panel"><h2 class="sf-dialog__title">' + esc(title) + '</h2><div class="sf-dialog__body">' + html + '</div><button type="button" class="sf-dialog__close" data-sf-close>Close</button></div>';
    document.body.appendChild(box);
    box.querySelector('[data-sf-close]').focus();
    return box;
  }
  function copy(value, message) {
    document.documentElement.setAttribute('data-sf-copied', value.slice(0, 2000));
    var done = function () { toast(message); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done, fallback); else fallback();
    function fallback() {
      var t = document.createElement('textarea');
      t.value = value; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      t.remove(); done();
    }
  }
  function download(name, type, data) {
    var blob = new Blob([data], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    document.documentElement.setAttribute('data-sf-download', name);
  }

  // ------------------------------------------------------------------ page facts (dates, phone, address)
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function findDate(scope) {
    var t = text(scope || main());
    var m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 9));
    m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(t);
    if (m) return new Date(Date.UTC(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2], 9));
    m = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})/i.exec(t);
    if (m) return new Date(Date.UTC(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1], 9));
    return null;
  }
  function findPhone() {
    var tel = document.querySelector('main a[href^="tel:"], a[href^="tel:"]');
    if (tel) return tel.getAttribute('href').slice(4);
    var m = /\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/.exec(text(document.body));
    return m ? m[0] : '';
  }
  function findAddress() {
    var a = main().querySelector('address');
    if (a) return text(a);
    var m = /\d{1,5}\s+[A-Z][\w.'’ -]{1,40}\s(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Lane|Way|Boulevard|Blvd\.?|Drive|Dr\.?|Place|Square|Parkway|Court)\b[^.;\n]{0,40}/.exec(text(main()));
    return m ? m[0].trim() : '';
  }

  // ------------------------------------------------------------------ "My list" (holds, lists, planner, follows)
  var SAVE_STATES = [[/place (a )?hold/i, 'Hold placed', 'Holds'], [/add to planner/i, 'In your planner', 'Planner'], [/research cart/i, 'In research cart', 'Research cart'], [/follow/i, 'Following', 'Following'], [/waitlist/i, 'On waitlist', 'Waitlists'], [/add to list|^save/i, 'Added to list', 'Saved to list']];
  function saveState(label) { for (var i = 0; i < SAVE_STATES.length; i++) if (SAVE_STATES[i][0].test(label)) return SAVE_STATES[i]; return SAVE_STATES[SAVE_STATES.length - 1]; }
  function itemFor(el) {
    var row = el.closest('tr, li, article, .pg-card, .pg-item');
    var link = row && !main().isSameNode(row) ? row.querySelector('a[href]') : null;
    if (link && row.closest('main')) return { title: text(link), url: new URL(link.getAttribute('href'), location.href).pathname };
    return { title: pageTitle(), url: location.pathname };
  }
  function listKey(label, item) { return saveState(label)[2] + '|' + item.url; }
  function toggleSave(btn) {
    var label = btn.getAttribute('data-sf-label') || labelOf(btn);
    btn.setAttribute('data-sf-label', label);
    var item = itemFor(btn);
    var list = store.get('list', []);
    var key = listKey(label, item);
    var at = list.findIndex(function (x) { return x.key === key; });
    var state = saveState(label);
    if (at >= 0) {
      list.splice(at, 1); store.set('list', list);
      btn.textContent = label; btn.setAttribute('aria-pressed', 'false');
      toast('Removed “' + item.title + '” from ' + state[2].toLowerCase() + '.', 'View my list', url('list'));
    } else {
      list.push({ key: key, group: state[2], action: label, title: item.title, url: item.url, savedAt: new Date().toISOString() });
      store.set('list', list);
      btn.textContent = state[1] + ' ✓'; btn.setAttribute('aria-pressed', 'true');
      toast(state[1] + ': “' + item.title + '”.', 'View my list', url('list'));
    }
  }
  function markSaved() {
    var list = store.get('list', []);
    if (!list.length) return;
    document.querySelectorAll('main button').forEach(function (btn) {
      var label = labelOf(btn);
      if (classify(btn, label) !== 'save') return;
      var key = listKey(label, itemFor(btn));
      if (list.some(function (x) { return x.key === key; })) { btn.setAttribute('data-sf-label', label); btn.textContent = saveState(label)[1] + ' ✓'; btn.setAttribute('aria-pressed', 'true'); }
    });
  }

  // ------------------------------------------------------------------ calendar file and PDF downloads
  function icsDate(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function addToCalendar(btn) {
    var title = pageTitle();
    var start = findDate() || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1, 9));
    var end = new Date(start.getTime() + 3600000);
    var where = findAddress();
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//' + SITE.replace(/[,;]/g, ' ') + '//Events//EN', 'BEGIN:VEVENT', 'UID:' + hash(location.pathname) + '@' + location.host, 'DTSTAMP:' + icsDate(new Date()), 'DTSTART:' + icsDate(start), 'DTEND:' + icsDate(end), 'SUMMARY:' + title.replace(/[,;]/g, ' '), 'URL:' + location.href.split('#')[0], where ? 'LOCATION:' + where.replace(/[,;]/g, ' ') : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    download(slug(title) + '.ics', 'text/calendar', ics + '\r\n');
    toast('Calendar file for “' + title + '” downloaded. Open it to add the event to your calendar.');
  }
  function pdfText(s) { return String(s).normalize('NFKD').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1'); }
  function makePdf(title, paragraphs) {
    var lines = [];
    paragraphs.forEach(function (p) {
      var words = pdfText(p).split(' '); var line = '';
      words.forEach(function (w) { if ((line + ' ' + w).length > 88) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w; });
      if (line) lines.push(line); lines.push('');
    });
    var pages = []; for (var i = 0; i < lines.length; i += 48) pages.push(lines.slice(i, i + 48));
    if (!pages.length) pages.push(['']);
    var objs = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
    var kids = [];
    pages.forEach(function (pl, n) {
      var s = 'BT /F2 16 Tf 56 780 Td (' + pdfText(n ? title + ' (continued)' : title) + ') Tj /F1 10 Tf 0 -26 Td 14 TL';
      pl.forEach(function (l) { s += ' (' + l + ') Tj T*'; });
      s += ' ET';
      objs.push('<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream');
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents ' + objs.length + ' 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>');
      kids.push(objs.length + ' 0 R');
    });
    objs[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
    var out = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var x = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(function (o) { return ('000000000' + o).slice(-10) + ' 00000 n \n'; }).join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
    return out;
  }
  function downloadPdf(btn) {
    var title = pageTitle();
    var label = labelOf(btn).replace(/^download\s*/i, '').replace(/\(pdf\)|pdf/i, '').trim();
    var paras = [SITE, label ? label.charAt(0).toUpperCase() + label.slice(1) + ' - ' + title : title];
    main().querySelectorAll('h2, h3, p, li, dt, dd, td, th').forEach(function (el) { if (!el.closest('form, nav, .pg-actions, [hidden]') && text(el)) paras.push(text(el)); });
    paras.push('Source: ' + location.href.split('#')[0]);
    download(slug(title + (label ? ' ' + label : '')) + '.pdf', 'application/pdf', makePdf(title, paras.slice(0, 160)));
    toast('PDF of “' + title + '” downloaded.');
  }

  // ------------------------------------------------------------------ listing filters, sort and view
  function listing() {
    var scope = main().querySelector('.pg-results') || main();
    var rows = scope.querySelectorAll('table tbody tr');
    if (rows.length > 1) return Array.prototype.slice.call(rows);
    var best = [], seen = new Set();
    scope.querySelectorAll('a[href]').forEach(function (a) {
      var el = a; while (el && el.parentElement && el.parentElement !== scope.parentElement) {
        var parent = el.parentElement;
        if (!seen.has(parent) && !parent.closest('nav, form, .breadcrumb, .pg-pager, .pagination, .pg-alpha, .pg-pills, .pg-active, header')) {
          seen.add(parent);
          var kids = Array.prototype.filter.call(parent.children, function (k) { return k.tagName === el.tagName && k.querySelector('a[href]'); });
          if (kids.length > best.length) best = kids;
        }
        el = parent;
      }
    });
    return best.length > 1 ? best : [];
  }
  var F = { q: '', terms: [], letter: '', sort: '' };
  function itemTitle(el) { var a = el.querySelector('a[href]'); return text(a || el); }
  function applyFilters(announce) {
    var items = listing();
    if (!items.length) return 0;
    var parent = items[0].parentElement;
    if (!parent._sfOrder) parent._sfOrder = items.slice();
    var ordered = parent._sfOrder.slice();
    var s = F.sort.toLowerCase();
    var dateOf = function (el) { var d = findDate(el); return d ? d.getTime() : null; };
    if (/z\s*[–-]\s*a|z to a/.test(s)) ordered.sort(function (a, b) { return keyOf(b).localeCompare(keyOf(a)); });
    else if (/a\s*[–-]\s*z|a to z|title|name/.test(s)) ordered.sort(function (a, b) { return keyOf(a).localeCompare(keyOf(b)); });
    else if (/newest|recent|latest|date added|soonest|upcoming|oldest|earliest/.test(s)) {
      var dir = /oldest|earliest|soonest|upcoming/.test(s) ? 1 : -1;
      ordered.sort(function (a, b) { var x = dateOf(a), y = dateOf(b); if (x === null && y === null) return 0; if (x === null) return 1; if (y === null) return -1; return (x - y) * dir; });
    }
    function keyOf(el) { var t = itemTitle(el); return /last name/.test(s) ? t.split(' ').slice(-1)[0] + ' ' + t : t; }
    ordered.forEach(function (el) { parent.appendChild(el); });
    var shown = 0;
    var words = F.q.toLowerCase().split(/\s+/).filter(Boolean);
    ordered.forEach(function (el) {
      var t = text(el).toLowerCase();
      var ok = words.every(function (w) { return t.indexOf(w) >= 0; })
        && (!F.terms.length || F.terms.some(function (w) { return t.indexOf(w.toLowerCase()) >= 0; }))
        && (!F.letter || itemTitle(el).replace(/^(the|a|an)\s+/i, '').charAt(0).toUpperCase() === F.letter);
      el.hidden = !ok; if (ok) shown++;
    });
    var count = main().querySelector('.pg-result-count');
    var msg = shown === ordered.length ? 'Showing all ' + shown + ' results' : 'Showing ' + shown + ' of ' + ordered.length + ' results';
    if (count) count.textContent = msg;
    var empty = main().querySelector('.sf-empty');
    if (!shown) {
      if (!empty) { empty = document.createElement('p'); empty.className = 'sf-empty'; parent.parentElement.insertBefore(empty, parent.nextSibling); }
      empty.innerHTML = 'No results match these filters. <button type="button" class="pg-btn pg-btn-ghost pg-btn-sm" data-sf-clear>Clear all filters</button>';
    } else if (empty) empty.remove();
    if (announce) toast(msg + (F.sort ? ', sorted by ' + F.sort.toLowerCase() : '') + '.');
    return shown;
  }
  function readFilterForm(form) {
    var q = form.querySelector('input[type=search], input[name=q]');
    F.q = q ? q.value.trim() : F.q;
    var terms = [];
    form.querySelectorAll('input[type=checkbox]:checked, input[type=radio]:checked').forEach(function (i) { var l = form.querySelector('label[for="' + i.id + '"]'); terms.push((l ? text(l) : i.value).replace(/\(\d+\)/, '').trim()); });
    form.querySelectorAll('select').forEach(function (sel) { if (sel.closest('.pg-sort')) return; var v = sel.options[sel.selectedIndex]; if (v && sel.selectedIndex > 0 && !/^(any|all)/i.test(text(v))) terms.push(text(v)); });
    F.terms = terms;
  }
  function setView(view) {
    var inner = main().querySelector('.pg-inner') || main();
    inner.classList.remove('pg-view-grid', 'pg-view-list'); inner.classList.add('pg-view-' + view);
    main().querySelectorAll('.pg-btn').forEach(function (b) {
      var l = labelOf(b).toLowerCase();
      if (l === 'grid' || l === 'list') { b.classList.toggle('pg-btn-primary', l === view); b.classList.toggle('pg-btn-ghost', l !== view); b.setAttribute('aria-pressed', String(l === view)); }
    });
  }
  function clearFilters() {
    F.q = ''; F.terms = []; F.letter = '';
    main().querySelectorAll('.pg-filterbar input[type=search], .pg-facets-form input[type=search]').forEach(function (i) { i.value = ''; });
    main().querySelectorAll('.pg-facets-form input:checked').forEach(function (i) { i.checked = false; });
    main().querySelectorAll('.pg-filterbar select').forEach(function (s) { s.selectedIndex = 0; });
    main().querySelectorAll('.pg-active .pg-btn-chip').forEach(function (c) { c.remove(); });
    main().querySelectorAll('.pg-alpha-l[aria-pressed=true], .pg-pills .pg-btn').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    applyFilters(true);
  }

  // ------------------------------------------------------------------ what each label means
  var RULES = [
    [/^print( this page| version)?$/i, 'print'], [/^(share( with a friend)?|copy link)$/i, 'share'], [/^(facebook|bluesky|x|twitter|linkedin|threads|mastodon)$/i, 'social'], [/^email$/i, 'email'], [/^(copy citation|cite)$/i, 'cite'], [/^copy page$/i, 'copytext'],
    [/^add to calendar$/i, 'ics'], [/^(place (a )?hold|add to (list|planner|research cart)|follow( author| artist)?|join waitlist|save)$/i, 'save'],
    [/^download image$/i, 'dlimage'], [/^download\b/i, 'pdf'], [/^get directions$/i, 'directions'], [/^call (the office|us)$/i, 'call'], [/^watch live$/i, 'live'],
    [/^(sign in|log in|my account|patient portal|renew items|open e-edition|e-edition|check (request|application) status)$/i, 'signin'], [/^search the catalog$/i, 'search'],
    [/^(find a (location|doctor|service|provider)|search the catalog|browse works|search)$/i, 'search'], [/^(yes|no)$/i, 'feedback'],
    [/^(all|grid|list|apply filters|clear all)$/i, 'filter'], [/^view textbooks$/i, 'textbooks'],
    [/^(request|book|reserve|register|apply|start|schedule|make an appointment|contact|get tickets|buy|become a member|join|donate|give|volunteer|subscribe|get a |get the newsletter|send a secure tip|submit a comment|plan your visit|visit|ask an|report an|pay a|get care|get an api key|sign up|fundraise|order copies|edit this page|get notices|give now)/i, 'request'],
  ];
  function classify(el, label) {
    if (el.closest('.pg-pills')) return 'pill';
    if (el.closest('.pg-active') && el.classList.contains('pg-btn-chip')) return 'chip';
    if (el.classList.contains('pg-alpha-l')) return 'letter';
    if (el.closest('.pg-filterbar, .pg-facets-form') && /^(search|apply filters)$/i.test(label)) return 'filter';
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(label)) return RULES[i][1];
    return null;
  }

  function act(btn, kind, label) {
    switch (kind) {
      case 'print': window.print(); document.documentElement.setAttribute('data-sf-printed', '1'); return;
      case 'share': copy(location.href.split('#')[0], 'Link to this page copied to the clipboard.'); return;
      case 'social': copy(pageTitle() + ' ' + location.href.split('#')[0], 'Post text and link copied. Paste them into a new ' + label + ' post.'); return;
      case 'email': {
        var mail = 'mailto:?subject=' + encodeURIComponent(pageTitle() + ' | ' + SITE) + '&body=' + encodeURIComponent(location.href.split('#')[0]);
        dialog('Email this page', '<p>Send “' + esc(pageTitle()) + '” to someone.</p><p><a class="pg-btn pg-btn-primary" href="' + esc(mail) + '">Open your email app</a> <button type="button" class="pg-btn pg-btn-secondary" data-sf-copy="' + esc(location.href.split('#')[0]) + '">Copy link instead</button></p>');
        return;
      }
      case 'cite': copy(pageTitle() + '. ' + SITE + '. ' + location.href.split('#')[0] + ' (accessed ' + new Date().toISOString().slice(0, 10) + ').', 'Citation copied to the clipboard.'); return;
      case 'copytext': copy(text(main()), 'Page text copied to the clipboard.'); return;
      case 'ics': addToCalendar(btn); return;
      case 'save': toggleSave(btn); return;
      case 'pdf': downloadPdf(btn); return;
      case 'dlimage': {
        var img = main().querySelector('img[src]:not([src^="data:"])');
        if (!img) { toast('This page has no image to download.'); return; }
        var a = document.createElement('a'); a.href = img.currentSrc || img.src; a.download = slug(pageTitle()) + (img.src.match(/\.\w+$/) || ['.png'])[0];
        document.body.appendChild(a); a.click(); a.remove(); document.documentElement.setAttribute('data-sf-download', a.download);
        toast('Image downloaded.'); return;
      }
      case 'directions': {
        var addr = findAddress();
        dialog('Directions to ' + pageTitle(), addr ? '<p>Address: <strong class="sf-address">' + esc(addr) + '</strong></p><p>Enter this address in your maps app, or copy it below.</p><button type="button" class="pg-btn pg-btn-secondary" data-sf-copy="' + esc(addr) + '">Copy address</button>'
          : '<p>This page does not list a street address. Contact us for directions.</p><p><a href="' + esc(url('request', { type: 'Contact us', item: pageTitle(), from: here() })) + '">Contact us</a></p>');
        return;
      }
      case 'call': {
        var phone = findPhone();
        dialog('Call ' + SITE, phone ? '<p>Phone: <a class="sf-phone" href="tel:' + esc(phone.replace(/[^\d+]/g, '')) + '">' + esc(phone) + '</a></p>' : '<p>No phone number is listed on this page.</p>');
        return;
      }
      case 'live': {
        var next = findDate();
        dialog('Live stream', '<p>No broadcast is live right now.' + (next ? ' The next session listed on this page is on <strong>' + esc(next.toUTCString().slice(0, 16)) + '</strong>.' : '') + '</p><p><button type="button" class="pg-btn pg-btn-secondary" data-sf-add-cal>Add it to my calendar</button></p>');
        return;
      }
      case 'signin': go(url('signin', { for: label, next: here() })); return;
      case 'search': go(url('search', { q: '', from: label })); return;
      case 'textbooks': dialog('Textbooks for ' + pageTitle(), '<p>No required textbooks are listed for this course yet. Course readings are posted by the instructor before the first class.</p>'); return;
      case 'feedback': {
        var box = btn.closest('.feedback-survey, .pg-box, div') || btn.parentElement;
        store.set('feedback:' + location.pathname, label.toLowerCase());
        box.innerHTML = '<p class="sf-thanks" role="status">Thanks for your feedback' + (/no/i.test(label) ? '. We will use it to improve this page.' : '!') + '</p>';
        toast('Thanks for your feedback.');
        return;
      }
      case 'pill': {
        btn.parentElement.querySelectorAll('.pg-btn').forEach(function (b) { b.classList.toggle('pg-btn-primary', b === btn); b.classList.toggle('pg-btn-chip', b !== btn); b.setAttribute('aria-pressed', String(b === btn)); });
        F.terms = /^all$/i.test(label) ? [] : [label];
        applyFilters(true); return;
      }
      case 'chip': {
        btn.remove();
        F.terms = F.terms.filter(function (t) { return t.toLowerCase() !== label.toLowerCase(); });
        if (!main().querySelector('.pg-active .pg-btn-chip')) { var act2 = main().querySelector('.pg-active'); if (act2) act2.hidden = true; }
        applyFilters(true); return;
      }
      case 'letter': {
        var on = btn.getAttribute('aria-pressed') !== 'true';
        btn.parentElement.querySelectorAll('.pg-alpha-l').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', String(on));
        F.letter = on ? label.toUpperCase() : '';
        applyFilters(true); return;
      }
      case 'filter': {
        var l = label.toLowerCase();
        if (l === 'grid' || l === 'list') { setView(l); toast('Showing results as a ' + l + '.'); return; }
        if (l === 'clear all') { clearFilters(); return; }
        if (l === 'all') { F.terms = []; applyFilters(true); return; }
        var form = btn.closest('form') || main().querySelector('.pg-facets-form, .pg-filterbar');
        if (form) readFilterForm(form);
        applyFilters(true); return;
      }
      case 'request': {
        go(url('request', { type: label, item: pageTitle(), from: here() })); return;
      }
    }
  }

  // ------------------------------------------------------------------ menus, consent, accessibility toolbar
  function setOpen(panel, open, toggle) {
    if (!panel) return;
    panel.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }
  function closeAll() {
    var off = document.getElementById('mobile-menu');
    if (off && !off.hidden) setOpen(off, false, document.querySelector('.sf-menu-toggle'));
    document.querySelectorAll('.megamenu__panel:not([hidden])').forEach(function (p) { p.hidden = true; });
    document.querySelectorAll('.sf-mega-toggle[aria-expanded=true]').forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
    var mm = document.getElementById('megamenu'); if (mm) mm.classList.remove('is-open');
    var d = document.querySelector('.sf-dialog'); if (d) d.remove();
  }
  function setupMenus() {
    var off = document.getElementById('mobile-menu');
    var header = document.querySelector('header .header-tools, header .header-inner:not(.header-nav), header');
    if (off && header && !document.querySelector('.sf-menu-toggle')) {
      var t = document.createElement('button');
      t.type = 'button'; t.className = 'sf-menu-toggle'; t.setAttribute('aria-controls', 'mobile-menu'); t.setAttribute('aria-expanded', 'false');
      t.innerHTML = '<span aria-hidden="true">☰</span> Menu';
      header.appendChild(t);
    }
    var mm = document.getElementById('megamenu');
    if (mm) {
      document.querySelectorAll('.site-nav > ul > li, nav[aria-label=Primary] > ul > li').forEach(function (li, i) {
        var panel = document.getElementById('megamenu-panel-' + (i + 1));
        var a = li.querySelector('a');
        if (!panel || !a || li.querySelector('.sf-mega-toggle')) return;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'sf-mega-toggle'; b.setAttribute('aria-controls', panel.id); b.setAttribute('aria-expanded', 'false');
        b.setAttribute('aria-label', 'Show ' + text(a) + ' menu'); b.textContent = '▾';
        a.insertAdjacentElement('afterend', b);
      });
    }
  }
  var CONSENT_CATS = ['necessary', 'functional', 'analytics', 'marketing', 'preferences'];
  function applyConsent(choice) {
    store.set('consent', choice);
    if (typeof window.siteTag === 'function') window.siteTag('consent', 'update', { analytics_storage: choice.analytics ? 'granted' : 'denied', ad_storage: choice.marketing ? 'granted' : 'denied' });
    var banner = document.getElementById('consent-banner'); if (banner) banner.hidden = true;
    var prefs = document.getElementById('consent-preferences'); if (prefs) prefs.hidden = true;
  }
  function openConsentPrefs() {
    var prefs = document.getElementById('consent-preferences');
    if (!prefs) {
      if (store.get('consent', null)) { store.del('consent'); toast('Your cookie choice has been cleared. You will be asked again on the next page you open.'); }
      else toast('No cookie choice is stored for this site.');
      return;
    }
    var saved = store.get('consent', {});
    prefs.querySelectorAll('input[type=checkbox]').forEach(function (c, i) { if (!c.disabled) c.checked = !!saved[CONSENT_CATS[i]]; });
    prefs.hidden = false;
    var first = prefs.querySelector('input:not([disabled]), button'); if (first) first.focus();
  }
  function setupConsent() {
    var banner = document.getElementById('consent-banner');
    if (banner && !store.get('consent', null)) banner.hidden = false;
  }
  function setupA11y() {
    var bar = document.getElementById('accessibility-toolbar');
    if (bar) bar.hidden = false;
    var s = store.get('a11y', { size: 100, contrast: false, readable: false });
    var root = document.documentElement;
    root.style.fontSize = s.size === 100 ? '' : s.size + '%';
    root.classList.toggle('sf-contrast', !!s.contrast);
    root.classList.toggle('sf-readable', !!s.readable);
    if (bar) bar.querySelectorAll('[data-a11y]').forEach(function (b) {
      var k = b.getAttribute('data-a11y');
      if (k === 'contrast') b.setAttribute('aria-pressed', String(!!s.contrast));
      if (k === 'dyslexic') b.setAttribute('aria-pressed', String(!!s.readable));
    });
  }
  function a11y(kind) {
    var s = store.get('a11y', { size: 100, contrast: false, readable: false });
    if (kind === 'text-larger') s.size = Math.min(150, s.size + 10);
    if (kind === 'text-smaller') s.size = Math.max(80, s.size - 10);
    if (kind === 'contrast') s.contrast = !s.contrast;
    if (kind === 'dyslexic') s.readable = !s.readable;
    store.set('a11y', s); setupA11y();
    toast(kind === 'contrast' ? 'High contrast ' + (s.contrast ? 'on' : 'off') + '.' : kind === 'dyslexic' ? 'Readable font ' + (s.readable ? 'on' : 'off') + '.' : 'Text size ' + s.size + '%.');
  }

  // ------------------------------------------------------------------ event wiring
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a');
    if (!t) return;
    if (t.matches('.sf-toast__close')) { t.parentElement.hidden = true; return; }
    if (t.matches('[data-sf-close]')) { var d = t.closest('.sf-dialog'); if (d) d.remove(); return; }
    if (t.matches('[data-sf-copy]')) { copy(t.getAttribute('data-sf-copy'), 'Copied to the clipboard.'); return; }
    if (t.matches('[data-sf-add-cal]')) { addToCalendar(t); return; }
    if (t.matches('[data-sf-clear]')) { clearFilters(); return; }
    if (t.matches('.sf-menu-toggle')) { var off = document.getElementById('mobile-menu'); setOpen(off, off.hidden, t); if (!off.hidden) { var f = off.querySelector('a, button'); if (f) f.focus(); } return; }
    if (t.matches('.off-canvas__close')) { setOpen(document.getElementById(t.getAttribute('data-close') || 'mobile-menu'), false, document.querySelector('.sf-menu-toggle')); return; }
    if (t.matches('.mobile-menu__toggle')) { var sub = document.getElementById(t.getAttribute('aria-controls')); setOpen(sub, sub.hidden, t); return; }
    if (t.matches('.sf-mega-toggle')) {
      var panel = document.getElementById(t.getAttribute('aria-controls')); var opening = panel.hidden;
      closeAll(); setOpen(panel, opening, t);
      var mega = document.getElementById('megamenu'); mega.classList.toggle('is-open', opening);
      if (opening) { var item = t.closest('li') || t; mega.style.top = (item.getBoundingClientRect().bottom + window.scrollY) + 'px'; }
      return;
    }
    if (t.matches('[data-consent]')) {
      var all = t.getAttribute('data-consent') === 'accept';
      var choice = {}; CONSENT_CATS.forEach(function (c, i) { choice[c] = i === 0 || all; });
      applyConsent(choice); toast(all ? 'All cookies accepted.' : 'Only strictly necessary cookies will be used.'); return;
    }
    if (t.matches('[data-open="consent-preferences"]') || (t.tagName === 'A' && /#cookie-settings$/.test(t.getAttribute('href') || ''))) { e.preventDefault(); openConsentPrefs(); return; }
    if (t.matches('[data-a11y]')) { a11y(t.getAttribute('data-a11y')); return; }
    if (t.tagName === 'A' && /^#./.test(t.getAttribute('href') || '')) { var target = document.getElementById(t.getAttribute('href').slice(1)); if (target && target.tagName === 'DETAILS') { target.open = true; } return; }
    if (t.matches('a.header-cta')) {
      // Header calls to action link to their section page; labels that name an action open that action instead.
      var cta = labelOf(t);
      var ckind = /^(sign in|log in|my account|patient portal|renew items)$/i.test(cta) ? 'signin' : /^search the catalog$/i.test(cta) ? 'search'
        : /^(get a library card|book a room|apply|apply for a program|contact an office|request a service|pay a bill|report an issue|visit|give|request info|book an appointment|get an api key|buy tickets|become a member|donate|give today|donate now|volunteer|request a record|book the reading room|ask an archivist|subscribe|subscribe for \$1|get the newsletter)$/i.test(cta) ? 'request' : null;
      if (ckind) { e.preventDefault(); act(t, ckind, cta); }
      return;
    }
    if (t.matches('.back-to-top')) return; // has its own onclick (scrolls to the top)
    if (t.tagName !== 'BUTTON' || t.type === 'submit' && t.closest('form:not(.pg-filterbar):not(.pg-facets-form)')) return;
    // Buttons that carry their own inline navigation (recorded crawler-trap and link noise) keep it.
    if (t.hasAttribute('onclick') || t.closest('[data-noise], .archive-action, .js-only-nav')) return;
    if (t.matches('.chat-launcher')) { go(url('request', { type: t.getAttribute('data-label') || 'Contact us', item: pageTitle(), from: here() })); return; }
    var label = labelOf(t);
    var kind = classify(t, label);
    if (!kind) return;
    e.preventDefault();
    act(t, kind, label);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('.pg-sort select')) { F.sort = text(t.options[t.selectedIndex]); applyFilters(true); return; }
    if (t.matches('#translate-select')) {
      var lang = text(t.options[t.selectedIndex]);
      toast(lang === 'English' ? 'Showing the page in English.' : 'A ' + lang + ' translation of this page is not available; the page is shown in English.');
    }
  });
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.matches('.pg-filterbar, .pg-facets-form, .pg-sort')) { e.preventDefault(); if (!form.matches('.pg-sort')) readFilterForm(form); applyFilters(true); return; }
    if (form.matches('.consent-preferences__form')) {
      e.preventDefault();
      var choice = {}; form.querySelectorAll('input[type=checkbox]').forEach(function (c, i) { choice[CONSENT_CATS[i]] = c.checked; });
      choice.necessary = true; applyConsent(choice); toast('Cookie preferences saved.'); return;
    }
    if (form.matches('.donate-modal__form')) { e.preventDefault(); var amt = form.querySelector('input[name=amount]:checked'); go(url('request', { type: 'Donate', amount: amt ? amt.value : '', item: pageTitle(), from: here() })); return; }
    if (form.matches('form[role=search], .site-search, .search-form, .sf-search-form')) {
      e.preventDefault();
      var q = form.querySelector('input[type=search], input[name=s], input[name=keys], input[name=q]');
      go(url('search', { q: q ? q.value.trim() : '' })); return;
    }
    var email = form.querySelector('input[type=email]');
    if (email && (form.matches('.newsletter-band__form, .pg-inline-form, .sf-subscribe-form') || form.querySelectorAll('input:not([type=hidden]):not([tabindex="-1"])').length === 1)) {
      e.preventDefault();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { email.setAttribute('aria-invalid', 'true'); toast('Enter a valid email address to subscribe.'); email.focus(); return; }
      var box = form.closest('section, .pg-box, aside, div');
      var title = box ? text(box.querySelector('h2, h3, .pg-box-title')) : '';
      go(url('subscribe', { email: email.value.trim(), list: title || SITE + ' newsletter', from: here() }));
    }
  });
  window.addEventListener('scroll', function () { var b = document.querySelector('.back-to-top'); if (b) b.hidden = window.scrollY < 600; }, { passive: true });

  // ------------------------------------------------------------------ URL parameters on ordinary pages
  function applyParams() {
    var p = new URLSearchParams(location.search);
    var q = p.get('s') || p.get('keys');
    if (q && q.trim() && !document.querySelector('[data-sf-page]')) { location.replace(url('search', { q: q.trim() })); return true; }
    if (p.get('print') === '1') {
      document.documentElement.classList.add('sf-print-view');
      var bar = document.createElement('div');
      bar.className = 'sf-printbar';
      bar.innerHTML = 'Print view of this page. <button type="button" class="pg-btn pg-btn-primary">Print this page</button> <a href="' + esc(location.pathname) + '">Back to the full page</a>';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    var pageNo = p.get('page');
    if (pageNo && pageNo !== '1') {
      var pager = Array.prototype.find.call(main().querySelectorAll('a[href]'), function (a) { return text(a) === pageNo && a.closest('nav, .pager, .pagination, .pg-pager, ul'); });
      if (pager) { location.replace(pager.href); return true; }
      toast('There is only one page of results; showing it.');
    }
    if (!listing().length) return false;
    var view = p.get('view'); if (view === 'grid' || view === 'list') setView(view);
    var sort = p.get('sort');
    var words = ['q', 'audience', 'format', 'topic', 'year'].map(function (k) { return p.get(k); }).filter(Boolean).map(function (v) { return v.replace(/-/g, ' '); });
    if (sort) F.sort = { newest: 'Newest first', oldest: 'Oldest first', title: 'Title A–Z', 'title-desc': 'Title Z–A' }[sort] || sort;
    if (words.length) F.terms = words;
    if (sort || words.length) applyFilters(false);
    return false;
  }

  function init() {
    if (window.SF_RUNTIME_CSS && !document.getElementById('sf-runtime-css')) { var st = document.createElement('style'); st.id = 'sf-runtime-css'; st.textContent = window.SF_RUNTIME_CSS; document.head.appendChild(st); }
    setupMenus(); setupConsent(); setupA11y();
    var chat = document.getElementById('chat-widget');
    if (chat && !chat.querySelector('.chat-launcher')) { chat.hidden = false; chat.innerHTML = '<button type="button" class="chat-launcher" data-label="' + esc(chat.getAttribute('data-label') || 'Contact us') + '">' + esc(chat.getAttribute('data-label') || 'Contact us') + '</button>'; }
    if (applyParams()) return;
    markSaved();
    var holder = document.querySelector('[data-sf-page]');
    var handler = holder && window.SiteUtilityPages && window.SiteUtilityPages[holder.getAttribute('data-sf-page')];
    if (handler) handler(api, holder);
    document.documentElement.setAttribute('data-sf-ready', 'true');
  }
  var api = { store: store, url: url, esc: esc, text: text, toast: toast, hash: hash, root: ROOT, site: SITE, pages: U, go: go };
  window.SiteActions = api;
  // Client-rendered pages (React/Angular builds) fill <main> after load: wait for the app before reading the page.
  function ready() {
    var app = document.querySelector('site-app[aria-busy]');
    if (app) { var n = 0; var timer = setInterval(function () { if (!document.querySelector('site-app[aria-busy]') || ++n > 100) { clearInterval(timer); init(); } }, 50); return; }
    init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
