/* FAQ accordion — ET export 288835's script, unchanged in behaviour (one item open at a time, clicks inside an
   open answer don't close it). It runs per section instead of once on DOMContentLoaded, so a duplicated FAQ gets an
   accordion of its own, and it listens on the section rather than on each item, so questions added in the editor
   open and close too. */
RevampSections.register('faq', function (section) {
  function setOpen(item, open) {
    item.classList.toggle('active', open);
    item.querySelector('.faq-question').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  section.addEventListener('click', function (event) {
    var item = event.target.closest('.faq-item');
    if (!item || !section.contains(item) || event.target.closest('.faq-answer-wrap')) return;
    var isActive = item.classList.contains('active');
    section.querySelectorAll('.faq-item').forEach(function (other) { if (other !== item) setOpen(other, false); });
    setOpen(item, !isActive);
  });
});
