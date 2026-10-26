/*
 * Desert Horology Co. page behaviour.
 *
 * 1. Lazy embeds: each reel card starts as a branded fallback link. When a card scrolls near the
 *    viewport we swap in Instagram's official embed (a blockquote that instagram.com/embed.js
 *    replaces with its player). The script is loaded once, on first use. If it never loads, the
 *    fallback card simply stays and links out.
 * 2. Modal: tiles in the "Latest posts" grid open the post in an on-page modal instead of
 *    leaving the site. Without JavaScript they are plain links to Instagram.
 */
(function () {
  'use strict';

  var EMBED_SCRIPT = 'https://www.instagram.com/embed.js';
  var scriptPromise = null;

  function loadEmbedScript() {
    if (window.instgrm && window.instgrm.Embeds) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = EMBED_SCRIPT;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        scriptPromise = null;
        reject(new Error('Instagram embed script failed to load'));
      };
      document.head.appendChild(script);
    });
    return scriptPromise;
  }

  function processEmbeds() {
    if (window.instgrm && window.instgrm.Embeds && typeof window.instgrm.Embeds.process === 'function') {
      window.instgrm.Embeds.process();
    }
  }

  function buildBlockquote(permalink, captioned) {
    var blockquote = document.createElement('blockquote');
    blockquote.className = 'instagram-media';
    blockquote.setAttribute('data-instgrm-permalink', permalink);
    blockquote.setAttribute('data-instgrm-version', '14');
    if (captioned) blockquote.setAttribute('data-instgrm-captioned', '');
    return blockquote;
  }

  // Turn a fallback card into a live embed. The fallback markup moves inside the blockquote so
  // it keeps showing until Instagram replaces the blockquote with its player.
  function activateEmbed(container) {
    if (!container || container.getAttribute('data-state')) return;
    var permalink = container.getAttribute('data-permalink');
    if (!permalink) return;
    container.setAttribute('data-state', 'loading');

    var blockquote = buildBlockquote(permalink, container.getAttribute('data-captioned') === 'true');
    while (container.firstChild) blockquote.appendChild(container.firstChild);
    container.appendChild(blockquote);

    loadEmbedScript().then(function () {
      container.setAttribute('data-state', 'ready');
      processEmbeds();
    }).catch(function () {
      container.setAttribute('data-state', 'fallback');
    });
  }

  function initLazyEmbeds() {
    var containers = Array.prototype.slice.call(document.querySelectorAll('.dhc-embed[data-permalink]'));
    if (!containers.length) return;

    if (!('IntersectionObserver' in window)) {
      containers.forEach(activateEmbed);
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        activateEmbed(entry.target);
      });
    }, { rootMargin: '600px 0px' });

    containers.forEach(function (el) { observer.observe(el); });
  }

  // ---- Modal ----------------------------------------------------------------------------------

  var modal = document.getElementById('dhc-modal');
  var modalBody = modal ? modal.querySelector('.dhc-modal-body') : null;
  var closeButton = modal ? modal.querySelector('.dhc-modal-close') : null;
  var lastFocused = null;

  if (modal && modal.parentNode !== document.body) {
    // Keep the modal outside the off-canvas wrapper so position: fixed is relative to the viewport.
    document.body.appendChild(modal);
  }

  function openModal(permalink) {
    if (!modal || !modalBody) return false;
    lastFocused = document.activeElement;
    modalBody.innerHTML = '';

    var blockquote = buildBlockquote(permalink, true);
    var fallback = document.createElement('a');
    fallback.className = 'dhc-fallback';
    fallback.href = permalink;
    fallback.target = '_blank';
    fallback.rel = 'noopener';
    fallback.textContent = 'Open this post on Instagram';
    blockquote.appendChild(fallback);
    modalBody.appendChild(blockquote);

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dhc-modal-open');
    if (closeButton) closeButton.focus();

    loadEmbedScript().then(processEmbeds).catch(function () { /* fallback link stays */ });
    return true;
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('dhc-modal-open');
    if (modalBody) modalBody.innerHTML = '';
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
  }

  function initModal() {
    if (!modal) return;

    document.addEventListener('click', function (event) {
      var closest = event.target.closest ? event.target.closest.bind(event.target) : null;
      if (!closest) return;

      var tile = closest('.dhc-feed-tile[data-permalink]');
      if (tile) {
        // Let modified clicks (new tab, etc.) behave like normal links.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        if (openModal(tile.getAttribute('data-permalink'))) event.preventDefault();
        return;
      }

      if (closest('[data-dhc-close]')) {
        event.preventDefault();
        closeModal();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeModal();
    });
  }

  initLazyEmbeds();
  initModal();
})();
