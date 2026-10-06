/* ET banner widget: the background video — ET's platform loader, kept as it behaves live: the video only starts downloading after
   the page has fully loaded plus a delay (longer on low-end devices) and an idle slot, or at once on the first
   click/touch/scroll. It fades in over the poster image when it can play. Nothing loads while editing.

   Shared by every template whose banner is ET's widget (template.json → sections[].widget: "et-banner").
   Dropped from ET's inline script: the "color detect" snippet — it looks for #event_header_color, which ET's
   microsite banners don't have, so it never did anything. */
RevampSections.widget('et-banner', function (section) {
  var video = section.querySelector('video.lazy-video');
  if (!video || RevampSections.editing()) return;

  function isLowEnd() {
    var hc = navigator.hardwareConcurrency || 0, dm = navigator.deviceMemory || 0;
    return (hc && hc <= 4) || (dm && dm <= 4);
  }
  function onIdle(cb) {
    if ('requestIdleCallback' in window) return requestIdleCallback(cb, { timeout: 2500 });
    return setTimeout(cb, 0);
  }
  function load() {
    if (video.dataset.loaded === '1') return;
    var src = video.getAttribute('data-src');
    if (!src) return;
    var source = video.querySelector('source');
    if (source) source.src = src;
    video.src = src;
    video.dataset.loaded = '1';
    video.load();
    video.addEventListener('canplay', function () {
      video.classList.add('loaded');
      video.play().catch(function () {});
    }, { once: true });
    video.addEventListener('error', function () { video.style.display = 'none'; }, { once: true });
  }
  function start() {
    setTimeout(function () { onIdle(load); }, isLowEnd() ? 6000 : 3000);
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });

  ['click', 'touchstart', 'scroll'].forEach(function (evt) {
    document.addEventListener(evt, load, { once: true, passive: true });
  });
});
