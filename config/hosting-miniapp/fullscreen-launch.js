(() => {
  const scope = document.documentElement.dataset.matScope;
  if (scope !== "usuarios" && scope !== "clientes") return;

  const destination = new URL(`https://pay0-next16--pay-0-system.us-central1.hosted.app/mat/${scope}`);
  destination.search = location.search;
  destination.hash = location.hash;

  let leaving = false;
  const openMat = () => {
    if (leaving) return;
    leaving = true;
    location.replace(destination.href);
  };

  const app = window.Telegram?.WebApp;
  if (!app?.initData || !app?.requestFullscreen) {
    openMat();
    return;
  }

  try {
    app.onEvent("fullscreenChanged", () => {
      if (app.isFullscreen) openMat();
    });
    app.onEvent("fullscreenFailed", openMat);
    app.ready();
    app.expand();
    if (app.isFullscreen) {
      openMat();
      return;
    }
    app.requestFullscreen();
    setTimeout(openMat, 1800);
  } catch {
    openMat();
  }
})();
