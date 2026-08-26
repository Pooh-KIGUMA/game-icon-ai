(() => {
  // Make the plan cards in the in-app credit modal actionable on mobile.
  // The existing pricing page already owns the real Stripe checkout flow.
  const goPricing = () => { window.location.href = '/pricing.html'; };

  function isPlanTarget(el) {
    if (!el || !el.closest) return false;
    const node = el.closest('button,a,[role="button"],article,.card,div');
    if (!node) return false;
    const text = (node.textContent || '').replace(/\s+/g, ' ');
    return /Standard|Pro/.test(text) && /(540|1,620|1620|30クレジット|120クレジット|月)/.test(text);
  }

  document.addEventListener('click', (event) => {
    if (isPlanTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      goPricing();
    }
  }, true);

  const style = document.createElement('style');
  style.textContent = '.card:has(*){cursor:pointer}.billing-plan-link{cursor:pointer!important}';
  document.head.appendChild(style);
})();
