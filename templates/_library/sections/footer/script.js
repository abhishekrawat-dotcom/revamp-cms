/* Real registration capture for generated pages — wires every [data-register-cta] link on the page
   (hero's primary CTA, the cta-band button, this footer's own "Register" link) to the shared modal markup
   in this section's own index.html, and submits it to the real, public POST /api/register endpoint
   (functions/lib/api.js). Before this, every "Register now" button on a generated page was a dead
   href="#" with nothing behind it at all.

   The event id comes from document.body.dataset.rvEventId — a plain DOM attribute set by
   handleGeneratedTemplate/template-loader.js's body.eventId, so it rides through canvas.serialize() into
   the actually-published static page the same as any other markup (this script never reads it from a URL
   query string, which the published page won't have). If that attribute is missing (e.g. a raw
   templates/_library preview with no real event behind it), every register link quietly does nothing
   rather than POST to an empty eventId — there is nothing meaningful to register against. */
(function () {
  'use strict';

  var modal = document.getElementById('revamp-register-modal');
  if (!modal) return;
  var form = modal.querySelector('.rv-register-form');
  var errorEl = modal.querySelector('.rv-register-error');
  var successEl = modal.querySelector('.rv-register-success');
  var submitBtn = modal.querySelector('.rv-register-submit');
  var eventId = (document.body && document.body.dataset && document.body.dataset.rvEventId) || '';

  function open() {
    if (!eventId) return;
    form.hidden = false; successEl.hidden = true; errorEl.hidden = true;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    var first = form.querySelector('input'); if (first) first.focus();
  }
  function close() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-register-cta]'), function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); open(); });
  });
  Array.prototype.forEach.call(modal.querySelectorAll('[data-register-close]'), function (el) {
    el.addEventListener('click', close);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var data = new FormData(form);
    var payload = {
      eventId: eventId,
      name: String(data.get('name') || '').trim(),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      company: String(data.get('company') || '').trim(),
      designation: String(data.get('designation') || '').trim(),
      city: String(data.get('city') || '').trim(),
      source: 'website'
    };
    if (!payload.name || !payload.email) {
      errorEl.textContent = 'Name and email are required.';
      errorEl.hidden = false;
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Registering…';
    fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error((body && body.error) || 'Could not register — please try again.');
        return body;
      });
    }).then(function () {
      form.hidden = true;
      successEl.hidden = false;
    }).catch(function (err) {
      errorEl.textContent = err.message || 'Could not register — please try again.';
      errorEl.hidden = false;
    }).finally(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register';
    });
  });
})();
