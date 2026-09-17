// Mintlify automatically includes JavaScript files placed beside docs.json on every page.
const isChineseRoute = () => /^\/cn(?:\/|$)/.test(window.location.pathname);

const syncDocumentLanguage = () => {
  const expectedLanguage = isChineseRoute() ? "zh-Hans" : "en";
  if (document.documentElement.lang !== expectedLanguage) {
    document.documentElement.lang = expectedLanguage;
  }
};

syncDocumentLanguage();
new MutationObserver(syncDocumentLanguage).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["lang"],
});
window.addEventListener("popstate", syncDocumentLanguage);
