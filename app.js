/* Denia Taxi Moto Paris, version 2 : simulateur à jauge, grille animée, balades, compteurs. */
(function () {
  var WA = 'https://wa.me/33668244343?text=';
  var $ = function (id) { return document.getElementById(id); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Grille tarifaire de Denia (TTC) : [trajet, jour, nuit, week-end] ── */
  var ROUTES = [
    ['Paris – Paris', 55, 75, 75],
    ['Paris – Orly', 80, 100, 100],
    ['Paris – Roissy CDG', 100, 120, 120],
    ['Roissy CDG – Orly', 130, 150, 150],
    ['La Défense – Orly', 100, 120, 120],
    ['La Défense – Roissy CDG', 110, 130, 130],
    ['La Défense – Paris', 70, 90, 90],
    ['Orly – Roissy CDG', 140, 160, 160]
  ];
  var KM_BASE = [35, 55, 55], KM_RATE = 2.5;
  var HOUR_RATE = 90;
  var LAST_MIN = [20, 20, 40];          // départ dans moins de 2 h
  var WAIT_RATE = [1.5, 2, 2.5];        // par minute, au-delà de 10 minutes
  var WAIT_FREE = 10;
  var SLOT_NAME = ['tarif de jour', 'tarif de nuit', 'tarif week-end'];
  var GAUGE_MAX = { forfait: 300, km: 700, heure: 1200 };

  function slotOf(d) {
    var day = d.getDay(), h = d.getHours();
    if (day === 6 || day === 0) return 2;
    if (day === 5 && h >= 20) return 2;
    if (day === 1 && h < 8) return 2;
    return (h >= 20 || h < 8) ? 1 : 0;
  }
  function fmt(n) { return (Math.round(n * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hourText(d) { return d.getHours() + ' h' + (d.getMinutes() ? ' ' + pad(d.getMinutes()) : ''); }
  function dateText(d) { return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }

  /* Compteur animé vers une valeur */
  function countTo(el, to, ms) {
    var from = parseFloat(el.getAttribute('data-v')) || 0;
    el.setAttribute('data-v', to);
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    cancelAnimationFrame(el._raf); clearTimeout(el._end);
    /* Filet : si l'onglet est en arrière-plan, l'animation ne tourne pas, on pose la valeur finale */
    el._end = setTimeout(function () { cancelAnimationFrame(el._raf); el.textContent = fmt(to); }, (ms || 500) + 150);
    (function tick(t) {
      var k = Math.min(1, (t - t0) / (ms || 500));
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) el._raf = requestAnimationFrame(tick); else el.textContent = fmt(to);
    })(t0);
  }

  /* Groupe de boutons à choix unique */
  function radios(box, onPick) {
    var btns = [].slice.call(box.querySelectorAll('button'));
    function pick(b, silent) {
      btns.forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); x.tabIndex = x === b ? 0 : -1; });
      if (!silent) onPick(b);
    }
    btns.forEach(function (b, i) {
      b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
      b.addEventListener('click', function () { pick(b); });
      b.addEventListener('keydown', function (e) {
        var d = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var n = btns[(i + d + btns.length) % btns.length];
        n.focus(); pick(n);
      });
    });
    return { set: function (sel) { var b = box.querySelector(sel); if (b) pick(b, true); } };
  }

  function rangeFill(input, fill) {
    var p = (input.value - input.min) / (input.max - input.min) * 100;
    fill.style.setProperty('--p', p + '%');
  }

  /* ───────── Simulateur ───────── */
  var simApi = null;
  if ($('sim')) {
    var st = { mode: 'forfait', route: 1, slot: 0 };
    var km = $('km'), heures = $('heures'), attente = $('attente'), last = $('last'), jour = $('jour'), heure = $('heure');

    /* Trajets */
    var routesBox = $('routes');
    routesBox.innerHTML = ROUTES.map(function (r, i) {
      return '<button type="button" role="radio" aria-checked="' + (i === st.route) + '" data-r="' + i + '">' + r[0] + '</button>';
    }).join('');

    /* Graduations de la jauge */
    var ticks = '';
    for (var i = 1; i < 10; i++) {
      ticks += '<rect x="158" y="27" width="4" height="26" transform="rotate(' + (-90 + i * 18) + ' 160 170)"/>';
    }
    $('g-ticks').innerHTML = ticks;

    var render = function () {
      var s = st.slot, lines = [], name, base;
      if (st.mode === 'forfait') {
        var r = ROUTES[st.route];
        base = r[1 + s]; name = r[0];
        lines.push(['Forfait ' + r[0], fmt(base) + ' €']);
      } else if (st.mode === 'km') {
        var k = +km.value;
        base = KM_BASE[s] + KM_RATE * k; name = 'Trajet de ' + k + ' km';
        lines.push(['Prise en charge', fmt(KM_BASE[s]) + ' €']);
        lines.push([k + ' km à 2,5 €', fmt(KM_RATE * k) + ' €']);
      } else {
        var h = +heures.value;
        base = HOUR_RATE * h; name = 'Mise à disposition de ' + h + ' h';
        lines.push([h + ' h à 90 €', fmt(base) + ' €']);
      }
      var total = base;
      if (last.checked && st.mode !== 'heure') {
        total += LAST_MIN[s];
        lines.push(['Dernière minute', '+' + fmt(LAST_MIN[s]) + ' €']);
      }
      var w = +attente.value;
      if (w > WAIT_FREE) {
        var wc = w * WAIT_RATE[s];
        total += wc;
        lines.push(['Attente de ' + w + ' min', '+' + fmt(wc) + ' €']);
      } else {
        lines.push(['Attente jusqu\'à 10 min', 'offerte']);
      }

      countTo($('res-price'), total, 450);
      var max = GAUGE_MAX[st.mode];
      var ratio = Math.max(0.02, Math.min(1, total / max));
      $('g-val').style.strokeDasharray = (ratio * 100) + ' 100';
      $('g-needle').style.rotate = (-90 + ratio * 180) + 'deg';
      $('g-max').textContent = fmt(max) + ' €';

      var when = new Date(jour.value + 'T' + (heure.value || '08:30'));
      var whenText = isNaN(when) ? '' : dateText(when) + ' à ' + hourText(when);
      $('res-line').textContent = name + ', ' + SLOT_NAME[s] + '.';
      $('res-detail').innerHTML = lines.map(function (l) { return '<li><span>' + l[0] + '</span><b>' + l[1] + '</b></li>'; }).join('');

      $('km-out').textContent = km.value + ' km';
      $('h-out').textContent = heures.value + ' h';
      $('att-out').textContent = attente.value + ' min';
      rangeFill(km, $('km-fill')); rangeFill(heures, $('h-fill')); rangeFill(attente, $('att-fill'));

      var msg = 'Bonjour Denia, je souhaite réserver : ' + name + (whenText ? ', ' + whenText : '') +
        ' (' + SLOT_NAME[s] + ')' + (w > WAIT_FREE ? ', avec environ ' + w + ' min d\'attente' : '') +
        '. Prix simulé sur votre site : ' + fmt(total) + ' €. Merci de me confirmer la disponibilité.';
      $('res-wa').href = WA + encodeURIComponent(msg);
    };

    var modeCtl = radios($('mode'), function (b) {
      st.mode = b.getAttribute('data-mode');
      ['forfait', 'km', 'heure'].forEach(function (m) { $('pane-' + m).hidden = m !== st.mode; });
      render();
    });
    var routeCtl = radios(routesBox, function (b) { st.route = +b.getAttribute('data-r'); render(); });
    var slotCtl = radios($('slot'), function (b) { st.slot = +b.getAttribute('data-slot'); render(); });

    /* La date et l'heure règlent le créneau et la dernière minute toutes seules */
    var fromWhen = function () {
      var when = new Date(jour.value + 'T' + (heure.value || '08:30'));
      if (isNaN(when)) return;
      st.slot = slotOf(when);
      slotCtl.set('[data-slot="' + st.slot + '"]');
      last.checked = (when - new Date()) < 2 * 3600 * 1000;
      render();
    };
    var t = new Date(); t.setDate(t.getDate() + 1);
    var today = new Date();
    jour.min = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    jour.value = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
    heure.value = '08:30';
    jour.addEventListener('change', fromWhen); heure.addEventListener('change', fromWhen);
    /* Le calcul du haut de page peut pré-régler le simulateur détaillé */
    simApi = { set: function (o) {
      st.mode = o.mode;
      modeCtl.set('[data-mode="' + o.mode + '"]');
      ['forfait', 'km', 'heure'].forEach(function (m) { $('pane-' + m).hidden = m !== st.mode; });
      if (o.mode === 'forfait') { st.route = o.route; routeCtl.set('[data-r="' + o.route + '"]'); }
      if (o.mode === 'km') km.value = Math.min(200, Math.max(10, o.km));
      if (o.jour) jour.value = o.jour;
      if (o.heure) heure.value = o.heure;
      fromWhen();
    } };
    [km, heures, attente].forEach(function (el) { el.addEventListener('input', render); });
    last.addEventListener('change', render);
    fromWhen();
  }

  /* ───────── Haut de page : départ, arrivée, prix calculé seul ───────── */
  var tripApi = null;
  if ($('trip')) {
    var PRESETS = [
      { label: 'Aéroport d\'Orly', sub: 'Terminaux 1 à 4', lat: 48.7262, lon: 2.3652, zone: 'orly', k: 'orly aeroport' },
      { label: 'Aéroport Roissy CDG', sub: 'Charles de Gaulle', lat: 49.0097, lon: 2.5479, zone: 'cdg', k: 'roissy cdg charles de gaulle aeroport' },
      { label: 'Aéroport du Bourget', sub: 'Aviation d\'affaires', lat: 48.9614, lon: 2.4372, zone: null, k: 'bourget aeroport jet prive' },
      { label: 'La Défense', sub: 'Quartier d\'affaires', lat: 48.8918, lon: 2.2389, zone: 'defense', k: 'defense' },
      { label: 'Gare de Lyon', sub: 'Paris 12e', lat: 48.8443, lon: 2.3744, zone: 'paris', k: 'gare lyon' },
      { label: 'Gare du Nord', sub: 'Paris 10e', lat: 48.8809, lon: 2.3553, zone: 'paris', k: 'gare nord' },
      { label: 'Gare Montparnasse', sub: 'Paris 15e', lat: 48.8409, lon: 2.3200, zone: 'paris', k: 'gare montparnasse' },
      { label: 'Tribunal de Paris', sub: 'Porte de Clichy, Paris 17e', lat: 48.8940, lon: 2.3113, zone: 'paris', k: 'tribunal palais justice clichy' },
      { label: 'Porte Maillot', sub: 'Paris 17e', lat: 48.8780, lon: 2.2824, zone: 'paris', k: 'porte maillot palais congres' },
      { label: 'Paris Expo Porte de Versailles', sub: 'Paris 15e', lat: 48.8323, lon: 2.2876, zone: 'paris', k: 'porte versailles expo salon' },
      { label: 'Parc des expositions de Villepinte', sub: 'Paris Nord Villepinte', lat: 48.9720, lon: 2.5160, zone: null, k: 'villepinte parc expositions salon' }
    ];
    var norm = function (t) { return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
    var hav = function (a, b) {
      var R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
      var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return 2 * R * Math.asin(Math.sqrt(x));
    };
    /* Zone de la grille : Paris, Orly, Roissy CDG, La Défense, ou hors grille */
    var zoneOf = function (p) {
      if (p.zone !== undefined) return p.zone;
      if (hav(p, PRESETS[0]) < 4) return 'orly';
      if (hav(p, PRESETS[1]) < 6) return 'cdg';
      if (hav(p, PRESETS[3]) < 1.4) return 'defense';
      if (/^75/.test(p.postcode || '')) return 'paris';
      return null;
    };
    var PAIRS = { 'paris|paris': 0, 'orly|paris': 1, 'cdg|paris': 2, 'defense|orly': 4, 'cdg|defense': 5, 'defense|paris': 6 };
    var forfaitOf = function (a, b) {
      var za = zoneOf(a), zb = zoneOf(b);
      if (!za || !zb) return -1;
      if (za === 'orly' && zb === 'cdg') return 7;
      if (za === 'cdg' && zb === 'orly') return 3;
      var k = [za, zb].sort().join('|');
      return (k in PAIRS) ? PAIRS[k] : -1;
    };

    var trip = { from: null, to: null, km: null, seq: 0 };
    var tJour = $('t-jour'), tHeure = $('t-heure'), tPrice = $('trip-price'), tLine = $('trip-line');
    var d1 = new Date(); d1.setDate(d1.getDate() + 1);
    var d0 = new Date();
    tJour.min = d0.getFullYear() + '-' + pad(d0.getMonth() + 1) + '-' + pad(d0.getDate());
    tJour.value = d1.getFullYear() + '-' + pad(d1.getMonth() + 1) + '-' + pad(d1.getDate());
    tHeure.value = '08:30';

    var lastCalc = null;
    var show = function () {
      var when = new Date(tJour.value + 'T' + (tHeure.value || '08:30'));
      if (isNaN(when)) when = new Date();
      var s = slotOf(when), soon = (when - new Date()) < 2 * 3600 * 1000;
      var dots = $('trip-steps').children;
      dots[0].classList.toggle('on', !!trip.from); dots[1].classList.toggle('on', !!trip.to); dots[2].classList.remove('on');
      if (!trip.from || !trip.to) {
        tPrice.textContent = 'Dès 55 €';
        tLine.textContent = trip.from || trip.to ? 'Encore une adresse et votre tarif s\'affiche.' : 'Indiquez le départ et l\'arrivée : votre tarif s\'affiche ici, tout de suite.';
        $('trip-slots').hidden = true; $('trip-wa').hidden = true;
        lastCalc = null; return;
      }
      var f = forfaitOf(trip.from, trip.to), price, line, calc;
      if (f > -1) {
        price = ROUTES[f][1 + s];
        line = '<b>Forfait ' + ROUTES[f][0] + '</b>, ' + SLOT_NAME[s] + '.';
        calc = { mode: 'forfait', route: f };
      } else {
        if (trip.km === null) { tPrice.classList.add('wait'); tLine.textContent = 'Calcul de la distance…'; $('trip-slots').hidden = true; $('trip-wa').hidden = true; return; }
        var k = Math.max(10, Math.round(trip.km));
        price = KM_BASE[s] + KM_RATE * k;
        line = '<b>' + k + ' km</b>, ' + SLOT_NAME[s] + ' : ' + fmt(KM_BASE[s]) + ' € + ' + k + ' × 2,5 €.' + (trip.km < 10 ? ' Minimum 10 km.' : '');
        calc = { mode: 'km', km: k };
      }
      if (soon) { price += LAST_MIN[s]; line += ' Départ dans moins de 2 h : +' + LAST_MIN[s] + ' €.'; }
      tPrice.classList.remove('wait');
      tPrice.innerHTML = '<span id="trip-n">0</span> €';
      var n = $('trip-n'); n.setAttribute('data-v', lastCalc ? lastCalc.price : Math.round(price * 0.6));
      countTo(n, price, 500);
      tLine.innerHTML = line;
      /* Le même trajet aux trois créneaux, celui de la date choisie en avant */
      var per = [0, 1, 2].map(function (i) { return f > -1 ? ROUTES[f][1 + i] : KM_BASE[i] + KM_RATE * calc.km; });
      var slots = $('trip-slots'), firstTime = slots.hidden;
      var html = ['Jour', 'Nuit', 'Week-end'].map(function (n, i) {
        return '<p' + (i === s ? ' class="now"' : '') + '><span>' + n + '</span><b>' + fmt(per[i]) + ' €</b></p>';
      }).join('');
      if (firstTime || slots.getAttribute('data-k') !== per.join('|') + s) { slots.innerHTML = html; slots.setAttribute('data-k', per.join('|') + s); }
      slots.hidden = false; $('trip-wa').hidden = false; dots[2].classList.add('on');
      calc.price = price; calc.jour = tJour.value; calc.heure = tHeure.value; lastCalc = calc;
      var msg = 'Bonjour Denia, je souhaite réserver : de ' + trip.from.label + ' à ' + trip.to.label + ', ' +
        dateText(when) + ' à ' + hourText(when) + '. Prix simulé sur votre site : ' + fmt(price) + ' € (' +
        (f > -1 ? 'forfait ' + ROUTES[f][0] : calc.km + ' km') + ', ' + SLOT_NAME[s] + '). Merci de me confirmer la disponibilité.';
      $('trip-wa').href = WA + encodeURIComponent(msg);
    };

    /* Distance par la route (OSRM), sinon à vol d'oiseau majoré */
    var findRoute = function () {
      trip.km = null;
      if (!trip.from || !trip.to) { show(); return; }
      if (forfaitOf(trip.from, trip.to) > -1) { show(); return; }
      var me = ++trip.seq, a = trip.from, b = trip.to;
      show();
      var done = function (km) { if (me !== trip.seq) return; trip.km = km; show(); };
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var to = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
      fetch('https://router.project-osrm.org/route/v1/driving/' + a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat + '?overview=false', ctl ? { signal: ctl.signal } : {})
        .then(function (r) { return r.json(); })
        .then(function (j) { clearTimeout(to); done(j && j.routes && j.routes[0] ? j.routes[0].distance / 1000 : hav(a, b) * 1.3); })
        .catch(function () { clearTimeout(to); done(hav(a, b) * 1.3); });
    };

    /* Champ d'adresse avec suggestions : lieux fréquents, puis adresses (Base adresse nationale) */
    var combo = function (input, list, key) {
      var opts = [], cur = -1, seq = 0, timer;
      var close = function () { list.hidden = true; input.setAttribute('aria-expanded', 'false'); cur = -1; };
      var paint = function (head) {
        if (!opts.length) { close(); return; }
        list.innerHTML = (head ? '<li class="sug-h" role="presentation">' + head + '</li>' : '') + opts.map(function (o, i) {
          return '<li role="option" id="' + input.id + '-o' + i + '" data-i="' + i + '" aria-selected="false">' + o.label + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</li>';
        }).join('');
        list.hidden = false; input.setAttribute('aria-expanded', 'true'); cur = -1;
      };
      var pick = function (o) {
        trip[key] = o; input.value = o.label; input.classList.add('ok'); close(); findRoute();
      };
      var mark = function (i) {
        var els = list.querySelectorAll('[role="option"]');
        [].forEach.call(els, function (el, j) { el.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
        cur = i;
        if (els[i]) { input.setAttribute('aria-activedescendant', els[i].id); els[i].scrollIntoView({ block: 'nearest' }); }
      };
      var search = function () {
        var q = input.value.trim();
        if (q.length < 2) { opts = PRESETS.slice(0, 7); paint('Lieux fréquents'); return; }
        var nq = norm(q);
        var local = PRESETS.filter(function (p) { return norm(p.label + ' ' + p.k).indexOf(nq) > -1; }).slice(0, 4);
        opts = local; paint();
        if (q.length < 3) return;
        var me = ++seq;
        fetch('https://data.geopf.fr/geocodage/search?limit=5&autocomplete=1&lat=48.8566&lon=2.3522&q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (me !== seq) return;
            var found = (j.features || []).map(function (f) {
              var p = f.properties;
              return { label: p.label, sub: p.context, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], postcode: p.postcode };
            });
            opts = local.concat(found); paint();
          })
          .catch(function () {});
      };
      input.addEventListener('focus', function () { if (!trip[key]) search(); });
      input.addEventListener('input', function () {
        if (trip[key]) { trip[key] = null; input.classList.remove('ok'); findRoute(); }
        clearTimeout(timer); timer = setTimeout(search, 200);
      });
      input.addEventListener('keydown', function (e) {
        if (list.hidden) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); mark(Math.min(opts.length - 1, cur + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); mark(Math.max(0, cur - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (opts[cur > -1 ? cur : 0]) pick(opts[cur > -1 ? cur : 0]); }
        else if (e.key === 'Escape') { close(); }
      });
      input.addEventListener('blur', function () { setTimeout(close, 150); });
      list.addEventListener('mousedown', function (e) {
        var li = e.target.closest('[role="option"]');
        if (!li) return;
        e.preventDefault(); pick(opts[+li.getAttribute('data-i')]);
      });
      return { set: function (o) { trip[key] = o; input.value = o ? o.label : ''; input.classList.toggle('ok', !!o); } };
    };
    var cFrom = combo($('from'), $('from-list'), 'from');
    var cTo = combo($('to'), $('to-list'), 'to');
    $('swap').addEventListener('click', function () {
      var a = trip.from, b = trip.to;
      cFrom.set(b); cTo.set(a); findRoute();
    });
    tJour.addEventListener('change', show); tHeure.addEventListener('change', show);
    /* Pré-remplir le trajet depuis une autre section (métiers, fin de page) */
    tripApi = { set: function (o) {
      if (o && o.from !== undefined) cFrom.set(PRESETS[o.from]);
      if (o && o.to !== undefined) { cTo.set(PRESETS[o.to]); if (o.from === undefined) cFrom.set(null); }
      findRoute();
      $('haut').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
      var empty = !trip.from ? $('from') : !trip.to ? $('to') : null;
      if (empty) setTimeout(function () { empty.focus({ preventScroll: true }); }, 700);
    } };
    $('trip-more').addEventListener('click', function () {
      if (simApi && lastCalc) simApi.set(lastCalc);
      else if (simApi) simApi.set({ mode: 'forfait', route: 1, jour: tJour.value, heure: tHeure.value });
    });
    show();
  }

  /* ───────── Étiquette de la photo : les forfaits de la grille défilent ───────── */
  if ($('hp-route') && !reduce) {
    var hpI = 1, hpBox = $('hp-route').parentElement;
    setInterval(function () {
      if (document.hidden) return;
      hpBox.classList.add('swap');
      setTimeout(function () {
        hpI = (hpI + 1) % ROUTES.length;
        $('hp-route').textContent = ROUTES[hpI][0];
        $('hp-price').textContent = ROUTES[hpI][1] + ' €';
        hpBox.classList.remove('swap');
      }, 320);
    }, 2800);
  }

  /* ───────── Grille en barres ───────── */
  if ($('tbars')) {
    var tb = $('tbars');
    tb.innerHTML = ROUTES.map(function (r) {
      return '<p class="tbar"><span>' + r[0] + '</span><i></i><b>' + r[1] + ' €</b></p>';
    }).join('');
    var rows = [].slice.call(tb.children);
    var paint = function (s) {
      rows.forEach(function (row, i) {
        var v = ROUTES[i][1 + s];
        row.querySelector('i').style.setProperty('--w', (v / 160 * 100) + '%');
        row.querySelector('b').textContent = v + ' €';
      });
    };
    var tctl = radios($('tslot'), function (b) { paint(+b.getAttribute('data-slot')); });
    var now = slotOf(new Date());
    tctl.set('[data-slot="' + now + '"]');
    /* Les barres se remplissent quand la grille arrive à l'écran */
    if ('IntersectionObserver' in window) {
      var tio = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { paint(now); tio.disconnect(); }
      }, { threshold: 0.2 });
      tio.observe(tb);
    } else { paint(now); }
  }

  /* ───────── Balades ───────── */
  if ($('tours')) {
    var TOURS = [
      { name: 'Paris Découverte', dur: '1 h', price: 120, say: 'Une première immersion au cœur de Paris.', photos: '1 arrêt photo',
        stops: ['Porte Maillot', 'Arc de Triomphe', 'Champs-Élysées', 'Place de la Concorde', 'Tour Eiffel', 'Trocadéro', 'Retour Porte Maillot'], ph: [] },
      { name: 'Paris Prestige', dur: '1 h 30', price: 150, say: 'La plus demandée. Les plus beaux monuments, dans une ambiance élégante et confortable.', photos: '3 arrêts photo',
        stops: ['Porte Maillot', 'Arc de Triomphe', 'Champs-Élysées', 'Grand Palais', 'Pont Alexandre III', 'Invalides', 'Tour Eiffel', 'Trocadéro', 'Avenue Kléber', 'Arc de Triomphe', 'Retour Porte Maillot'], ph: [1, 4, 7] },
      { name: 'Paris VIP', dur: '2 h', price: 190, say: 'L\'expérience complète, pour voir les incontournables de la ville lumière.', photos: '4 à 5 arrêts photo',
        stops: ['Porte Maillot', 'Arc de Triomphe', 'Champs-Élysées', 'Place de la Concorde', 'Jardin des Tuileries', 'Louvre et Pyramide', 'Pont-Neuf', 'Notre-Dame', 'Hôtel de Ville', 'Pont Alexandre III', 'Invalides', 'Tour Eiffel', 'Trocadéro', 'Arc de Triomphe', 'Retour Porte Maillot'], ph: [] }
    ];
    var ts = { tour: 1, photo: 0, min: 0 };
    var route = $('route');
    var tourRender = function (redraw) {
      var T = TOURS[ts.tour];
      var total = T.price + 15 * ts.photo + 50 * ts.min;
      countTo($('tour-price'), total, 400);
      $('tour-say').textContent = T.say;
      $('n-photo').textContent = ts.photo; $('n-min').textContent = ts.min;
      $('tour-stops').textContent = T.photos + (ts.photo ? ' + ' + ts.photo : '') + ' · ' + T.dur + (ts.min ? ' + ' + (ts.min * 30) + ' min' : '');
      if (redraw) {
        route.classList.remove('go');
        route.innerHTML = T.stops.map(function (s, i) {
          var ph = T.ph.indexOf(i) > -1;
          return '<li style="--i:' + i + '"' + (ph ? ' class="ph"' : '') + '>' + s + (ph ? '<small>arrêt photo</small>' : '') + '</li>';
        }).join('');
        void route.offsetWidth; route.classList.add('go');
      }
      var opts = [];
      if (ts.photo) opts.push(ts.photo + ' arrêt' + (ts.photo > 1 ? 's' : '') + ' photo en plus');
      if (ts.min) opts.push((ts.min * 30) + ' minutes en plus');
      var msg = 'Bonjour Denia, je souhaite réserver la balade ' + T.name + ' (' + T.dur + ')' +
        (opts.length ? ', avec ' + opts.join(' et ') : '') + '. Prix simulé sur votre site : ' + fmt(total) + ' €.';
      $('tour-wa').href = WA + encodeURIComponent(msg);
    };
    radios($('tours'), function (b) { ts.tour = +b.getAttribute('data-tour'); tourRender(true); });
    [].forEach.call(document.querySelectorAll('[data-step]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-step'), d = +b.getAttribute('data-d');
        ts[k] = Math.max(0, Math.min(k === 'photo' ? 5 : 4, ts[k] + d));
        tourRender(false);
      });
    });
    $('tour-price').setAttribute('data-v', TOURS[1].price);
    tourRender(true);
  }

  /* ───────── Métiers : presse, avocats, aviation d'affaires, dirigeants, événements ───────── */
  if ($('met-tabs')) {
    var MET = [
      { k: 'Presse', h: 'Au plus près de l\'événement',
        p: 'Journalistes, photographes, cadreurs : Denia vous emmène suivre un cortège, rejoindre un direct ou rapporter vos images avant le bouclage.',
        pts: ['Mise à disposition : 90 € l\'heure', 'Départ dans moins de 2 h : +20 € en semaine, +40 € le week-end', 'Disponible 24 h/24 et 7 j/7, sur réservation'],
        cta: 'Simuler une mise à disposition', sim: { mode: 'heure' } },
      { k: 'Avocats', h: 'À l\'heure de l\'audience',
        p: 'Tribunal de Paris, Palais de justice, cabinets : vous arrivez à l\'heure, dossier sous le bras, sans dépendre du trafic.',
        pts: ['Paris – Paris : 55 € en journée, 75 € la nuit', 'Attente offerte jusqu\'à 10 minutes', 'Prix fixé avant le départ'],
        cta: 'Simuler un trajet vers le Tribunal', trip: { to: 7 } },
      { k: 'Aviation d\'affaires', h: 'De Paris au pied de l\'avion',
        p: 'Passagers et équipages : Denia rejoint Le Bourget et ses terminaux privés, y compris quand l\'autoroute est à l\'arrêt.',
        pts: ['35 € + 2,5 € par km en journée', '55 € + 2,5 € par km la nuit et le week-end', 'Deux valises cabine à l\'arrière'],
        cta: 'Simuler un trajet vers Le Bourget', trip: { to: 2 } },
      { k: 'Dirigeants', h: 'Trois rendez-vous, une matinée',
        p: 'La Défense, gares, sièges, aéroports : vous enchaînez les adresses sans regarder l\'heure.',
        pts: ['La Défense – Orly : 100 € en journée', 'La Défense – Roissy CDG : 110 € en journée', 'La Défense – Paris : 70 € en journée'],
        cta: 'Simuler La Défense – Orly', trip: { from: 3, to: 0 } },
      { k: 'Événements', h: 'Salons, défilés, tournages',
        p: 'Une journée à plusieurs adresses : Denia reste à votre disposition et vous attend entre deux lieux.',
        pts: ['Mise à disposition : 90 € l\'heure', 'Porte de Versailles, Villepinte, Porte Maillot', 'Longues distances sur devis'],
        cta: 'Simuler une mise à disposition', sim: { mode: 'heure' } }
    ];
    var tabs = $('met-tabs'), panel = $('met-panel'), curMet = 0;
    tabs.innerHTML = MET.map(function (m, i) {
      return '<button type="button" role="tab" id="met-t' + i + '" aria-controls="met-panel" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' + m.k + '</button>';
    }).join('');
    var tabEls = [].slice.call(tabs.children);
    var metShow = function (i, focus) {
      curMet = i; var m = MET[i];
      tabEls.forEach(function (t, j) { t.setAttribute('aria-selected', j === i ? 'true' : 'false'); t.tabIndex = j === i ? 0 : -1; });
      panel.setAttribute('aria-labelledby', 'met-t' + i);
      panel.classList.remove('go');
      panel.innerHTML = '<h3>' + m.h + '</h3><p>' + m.p + '</p><ul>' + m.pts.map(function (x) { return '<li>' + x + '</li>'; }).join('') +
        '</ul><button type="button" class="btn" id="met-cta">' + m.cta + '</button>';
      void panel.offsetWidth; panel.classList.add('go');
      if (focus) tabEls[i].focus();
      $('met-cta').addEventListener('click', function () {
        if (m.trip && tripApi) tripApi.set(m.trip);
        else if (m.sim && simApi) { simApi.set(m.sim); $('prix').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); }
      });
    };
    tabEls.forEach(function (t, i) {
      t.addEventListener('click', function () { metShow(i); });
      t.addEventListener('keydown', function (e) {
        var d = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
        if (!d) return; e.preventDefault(); metShow((i + d + MET.length) % MET.length, true);
      });
    });
    metShow(0);
  }
  if ($('end-calc')) {
    $('end-calc').addEventListener('click', function (e) { if (tripApi) { e.preventDefault(); tripApi.set({}); } });
  }

  /* ───────── Compteurs TikTok ───────── */
  var counters = document.querySelectorAll('[data-count]');
  if (counters.length && 'IntersectionObserver' in window && !reduce) {
    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.setAttribute('data-v', 0);
        countTo(e.target, +e.target.getAttribute('data-count'), 1400);
        cio.unobserve(e.target);
      });
    }, { threshold: 0.6 });
    [].forEach.call(counters, function (c) { cio.observe(c); });
  }

  /* ───────── Lettres ajustées à la largeur ───────── */
  function fit() {
    document.querySelectorAll('[data-fit]').forEach(function (el) {
      var box = el.parentElement, cs = getComputedStyle(box);
      var avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      el.style.fontSize = '';
      var size = parseFloat(getComputedStyle(el).fontSize);
      var w = el.getBoundingClientRect().width;
      if (!w) return;
      var next = size * (avail / w) * 0.995;
      var cap = el.getAttribute('data-maxvh');
      if (cap) next = Math.min(next, window.innerHeight * (+cap) / 100);
      el.style.fontSize = next + 'px';
    });
  }
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener('load', fit);
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(fit, 120); });

  /* ───────── Entrées au défilement ───────── */
  var items = document.querySelectorAll('.rv');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      var n = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.style.setProperty('--d', (n++ * 70) + 'ms');
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }

  /* ───────── La bulle s'efface devant le numéro en grand ───────── */
  var bubble = document.querySelector('.bubble');
  var zones = [$('reserver'), $('trip-wa'), document.querySelector('.hp-bar')].filter(Boolean), seenZones = 0;
  if (bubble && zones.length && 'IntersectionObserver' in window) {
    var bio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target._in = e.isIntersecting; });
      seenZones = zones.filter(function (z) { return z._in; }).length;
      bubble.classList.toggle('off', seenZones > 0);
    }, { rootMargin: '0px 0px -4% 0px' });
    zones.forEach(function (z) { bio.observe(z); });
  }

  /* ───────── Barre de progression et barre haute ───────── */
  var bar = $('progress'), top = $('top');
  var onScroll = function () {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.scale = (max > 0 ? window.scrollY / max : 0) + ' 1';
    if (top) top.classList.toggle('solid', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
